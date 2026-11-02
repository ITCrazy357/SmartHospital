import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';
import { MailService } from '../auth/mail.service';
import { AppointmentStatus } from '../models/enums';
import type { AppointmentReminderKind } from '../models/appointment-reminder.model';

/**
 * Cấu hình mốc nhắc lịch:
 *  - h24: 24h trước slot. Cron quét trong khoảng [now+23h, now+24h] (cửa sổ 1h ≫ chu kỳ 5 phút).
 *  - h1 : 1h trước slot.  Cron quét trong khoảng [now, now+1h] (cũng đủ rộng).
 * Cửa sổ rộng hơn chu kỳ cron đảm bảo: nếu server tắt 30 phút mid-window,
 * lần chạy kế tiếp vẫn bắt được. Idempotency dựa vào PRIMARY KEY của bảng
 * appointment_reminders. Delivery is at-least-once: a crash after provider acceptance
 * but before recording success can cause a duplicate on retry.
 */
const REMINDER_WINDOWS: Record<
  AppointmentReminderKind,
  { fromOffsetSeconds: number; toOffsetSeconds: number }
> = {
  h24: { fromOffsetSeconds: 23 * 3600, toOffsetSeconds: 24 * 3600 },
  h1: { fromOffsetSeconds: 0, toOffsetSeconds: 1 * 3600 },
};

interface CandidateRow {
  id: string;
  user_id: string;
  doctor_id: string;
  slot_time: string; // PG timestamp string
  user_email: string | null;
  user_full_name: string | null;
  doctor_full_name: string | null;
  department_name: string | null;
}

@Injectable()
export class AppointmentRemindersService {
  private readonly logger = new Logger(AppointmentRemindersService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly mailService: MailService,
  ) {}

  /**
   * Quét các cuộc hẹn cần nhắc cho 2 mốc h24 + h1, gửi mail và ghi log idempotent.
   * Trả về số lượng đã gửi từng loại — dùng cho endpoint admin "Chạy thủ công".
   */
  async runRemindersOnce(): Promise<{
    h24Sent: number;
    h1Sent: number;
    h24Failed: number;
    h1Failed: number;
    skipped: number;
  }> {
    if (!this.mailService.isConfigured()) {
      this.logger.warn(
        'SMTP/MAIL_FROM chưa cấu hình — bỏ qua gửi email nhắc lịch.',
      );
      return { h24Sent: 0, h1Sent: 0, h24Failed: 0, h1Failed: 0, skipped: 0 };
    }

    const h24 = await this.processKind('h24');
    const h1 = await this.processKind('h1');

    return {
      h24Sent: h24.sent,
      h1Sent: h1.sent,
      h24Failed: h24.failed,
      h1Failed: h1.failed,
      skipped: h24.skipped + h1.skipped,
    };
  }

  private async processKind(
    kind: AppointmentReminderKind,
  ): Promise<{ sent: number; failed: number; skipped: number }> {
    const win = REMINDER_WINDOWS[kind];

    // Lấy ứng viên: confirmed, slot trong cửa sổ, chưa từng gửi mốc này.
    // LEFT JOIN appointment_reminders để lọc cái đã có row.
    const rows = (await this.dataSource.query(
      `
      SELECT
        a.id,
        a.user_id,
        a.doctor_id,
        s.slot_time,
        u.email      AS user_email,
        u.full_name  AS user_full_name,
        d.full_name  AS doctor_full_name,
        dep.name     AS department_name
      FROM appointments a
      JOIN appointment_slots s ON s.id = a.slot_id
      JOIN users u  ON u.id = a.user_id
      JOIN users d  ON d.id = a.doctor_id
      LEFT JOIN departments dep ON dep.id = d.department_id
      LEFT JOIN appointment_reminders r
             ON r.appointment_id = a.id AND r.kind = $1
      WHERE a.status = $2
        AND (s.slot_time AT TIME ZONE 'Asia/Ho_Chi_Minh') >= now() + ($3 || ' seconds')::interval
        AND (s.slot_time AT TIME ZONE 'Asia/Ho_Chi_Minh') <  now() + ($4 || ' seconds')::interval
        AND (r.appointment_id IS NULL OR (r.status NOT IN ('sent','skipped') AND r.next_attempt_at <= now()
          AND (r.locked_until IS NULL OR r.locked_until < now())))
      `,
      [
        kind,
        AppointmentStatus.Confirmed,
        String(win.fromOffsetSeconds),
        String(win.toOffsetSeconds),
      ],
    )) as CandidateRow[];

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of rows) {
      // Bỏ qua nếu user không có email (về lý thuyết user.email là NOT NULL UNIQUE,
      // nhưng vẫn check để code chịu được dirty data).
      if (!row.user_email) {
        skipped++;
        continue;
      }

      // (1) RESERVE trước bằng INSERT — race-safe. Hai worker chạy song song
      // chỉ có 1 INSERT thắng nhờ PRIMARY KEY (appointment_id, kind).
      // ON CONFLICT DO NOTHING → kẻ thua không throw, vòng for tiếp tục.
      const reserved = (await this.dataSource.query(
        `
        INSERT INTO appointment_reminders (appointment_id, kind, sent_at, status, attempts, locked_until)
        VALUES ($1, $2, now(), 'processing', 1, now()+interval '2 minutes')
        ON CONFLICT (appointment_id, kind) DO UPDATE SET status='processing',
          attempts=appointment_reminders.attempts+1, locked_until=now()+interval '2 minutes'
        WHERE appointment_reminders.status NOT IN ('sent','skipped') AND appointment_reminders.next_attempt_at <= now()
          AND (appointment_reminders.locked_until IS NULL OR appointment_reminders.locked_until < now())
        RETURNING appointment_id, attempts
        `,
        [row.id, kind],
      )) as { appointment_id: string; attempts: number }[];

      if (reserved.length === 0) {
        skipped++;
        continue; // worker khác đã lấy / đã gửi.
      }

      // (2) GỬI MAIL — nếu lỗi mạng/SMTP, rollback row đã reserve để lần cron sau retry.
      try {
        const active = await this.dataSource.query("SELECT 1 FROM appointments WHERE id=$1 AND status='confirmed'", [row.id]);
        if (!active.length) {
          await this.dataSource.query("UPDATE appointment_reminders SET status='skipped',locked_until=NULL,last_error='appointment_no_longer_confirmed' WHERE appointment_id=$1 AND kind=$2 AND attempts=$3",[row.id,kind,reserved[0].attempts]);
          skipped++; continue;
        }
        await this.mailService.sendAppointmentReminderEmail(row.user_email, {
          patientName: row.user_full_name ?? 'Quý khách',
          doctorName: row.doctor_full_name ?? 'Bác sĩ',
          departmentName: row.department_name,
          slotTime: new Date(row.slot_time),
          kind,
        });
        await this.dataSource.query(`UPDATE appointment_reminders SET status='sent',sent_at=now(),locked_until=NULL,last_error=NULL
          WHERE appointment_id=$1 AND kind=$2 AND attempts=$3`,[row.id,kind,reserved[0].attempts]);
        sent++;
      } catch (e) {
        failed++;
        this.logger.warn(
          `Gửi nhắc lịch (${kind}) appt=${row.id} thất bại: ${e instanceof Error ? e.message : e}`,
        );
        try {
          await this.dataSource.query(
            `UPDATE appointment_reminders SET status='failed',locked_until=NULL,last_error='delivery_failed',
              next_attempt_at=now()+interval '5 minutes' WHERE appointment_id = $1 AND kind = $2 AND attempts=$3`,
            [row.id, kind, reserved[0].attempts],
          );
        } catch (delErr) {
          // Xoá row dự phòng cũng lỗi → để nguyên, log thôi; sẽ không tự retry mốc này.
          this.logger.error(
            `Rollback reservation thất bại appt=${row.id} kind=${kind}: ${
              delErr instanceof Error ? delErr.message : delErr
            }`,
          );
        }
      }
    }

    if (sent + failed > 0) {
      this.logger.log(
        `Reminder ${kind}: gửi ${sent}, lỗi ${failed}, bỏ qua ${skipped}.`,
      );
    }
    return { sent, failed, skipped };
  }

  /**
   * Force-send mail nhắc lịch cho 1 appointment cụ thể — DÙNG ĐỂ TEST.
   * Bỏ qua: cửa sổ thời gian, status appointment, bảng appointment_reminders.
   * Subject sẽ prefix [TEST] để user/admin biết đây là mail test (không phải nhắc thật).
   * Có thể bấm nhiều lần → mail vẫn được gửi mỗi lần (không idempotent có chủ đích).
   */
  async sendTestReminder(
    appointmentId: string,
    kind: AppointmentReminderKind,
  ): Promise<{ to: string; kind: AppointmentReminderKind }> {
    if (!this.mailService.isConfigured()) {
      throw new BadRequestException(
        'SMTP/MAIL_FROM chưa cấu hình — không gửi được email test.',
      );
    }

    const rows = (await this.dataSource.query(
      `
      SELECT
        a.id,
        s.slot_time,
        u.email      AS user_email,
        u.full_name  AS user_full_name,
        d.full_name  AS doctor_full_name,
        dep.name     AS department_name
      FROM appointments a
      LEFT JOIN appointment_slots s ON s.id = a.slot_id
      JOIN users u  ON u.id = a.user_id
      JOIN users d  ON d.id = a.doctor_id
      LEFT JOIN departments dep ON dep.id = d.department_id
      WHERE a.id = $1
      `,
      [appointmentId],
    )) as {
      id: string;
      slot_time: string | null;
      user_email: string | null;
      user_full_name: string | null;
      doctor_full_name: string | null;
      department_name: string | null;
    }[];

    if (rows.length === 0) {
      throw new NotFoundException('Không tìm thấy cuộc hẹn');
    }
    const row = rows[0];
    if (!row.user_email) {
      throw new BadRequestException('Bệnh nhân không có email');
    }
    if (!row.slot_time) {
      throw new BadRequestException('Cuộc hẹn không có slot_time để hiển thị');
    }

    await this.mailService.sendAppointmentReminderEmail(row.user_email, {
      patientName: row.user_full_name ?? 'Quý khách',
      doctorName: row.doctor_full_name ?? 'Bác sĩ',
      departmentName: row.department_name,
      slotTime: new Date(row.slot_time),
      kind,
      isTest: true,
    });

    this.logger.log(
      `[TEST] Đã gửi reminder ${kind} appt=${appointmentId} -> ${row.user_email}`,
    );
    return { to: row.user_email, kind };
  }

  /**
   * Cron mỗi 5 phút — đủ chính xác cho mốc 24h/1h, không tốn query.
   * Cửa sổ rộng 1h ≫ chu kỳ 5 phút → server tắt vài chục phút vẫn không miss.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'appointments-reminders' })
  async cronRunReminders(): Promise<void> {
    try {
      await this.runRemindersOnce();
    } catch (e) {
      // Bao toàn bộ — không cho cron crash NestJS.
      if (e instanceof QueryFailedError) {
        this.logger.error(`Cron reminders DB lỗi: ${e.message}`);
      } else {
        this.logger.error(`Cron reminders lỗi: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
}
