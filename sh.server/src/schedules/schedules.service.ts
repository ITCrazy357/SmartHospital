import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { createHash } from 'crypto';
import { lockDoctor } from '../common/doctor-lock';
import {
  addDays,
  buildSlotTimes,
  changedWeekdays,
  isoDate,
  SLOT_HORIZON_DAYS,
  todayVn,
  validateRules,
  type ScheduleRule,
} from './schedule.rules';

export interface ScheduleException {
  workDate: string;
  closed: boolean;
  reason: string;
}
export interface SchedulePlan {
  rules: ScheduleRule[];
  exceptions: ScheduleException[];
  version: string;
  isLocked: boolean;
}
export interface SlotConflict {
  slotId: string;
  slotTime: string;
}

@Injectable()
export class SchedulesService implements OnModuleInit {
  private readonly logger = new Logger(SchedulesService.name);
  constructor(private readonly dataSource: DataSource) {}

  private async readPlan(
    em: EntityManager,
    doctorId: string,
  ): Promise<SchedulePlan> {
    const doctors = await em.query(
      `SELECT id, is_locked FROM users WHERE id = $1 AND role = 'doctor'`,
      [doctorId],
    );
    if (!doctors.length) throw new NotFoundException('Không tìm thấy bác sĩ');
    const rows = await em.query(
      `SELECT weekday, left(start_time::text,5) AS start_time,
      left(end_time::text,5) AS end_time, interval_minutes FROM doctor_schedule_rules
      WHERE doctor_id = $1 ORDER BY weekday,start_time`,
      [doctorId],
    );
    const rules: ScheduleRule[] = rows.map((r) => ({
      weekday: r.weekday,
      startTime: r.start_time,
      endTime: r.end_time,
      intervalMinutes: r.interval_minutes,
    }));
    const exceptions: ScheduleException[] = (
      await em.query(
        `SELECT to_char(work_date,'YYYY-MM-DD') AS work_date, closed, reason
      FROM doctor_schedule_exceptions WHERE doctor_id = $1 AND work_date >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date ORDER BY work_date`,
        [doctorId],
      )
    ).map((r) => ({
      workDate: r.work_date,
      closed: r.closed,
      reason: r.reason,
    }));
    const version = createHash('sha256')
      .update(JSON.stringify({ rules, exceptions }))
      .digest('hex');
    return { rules, exceptions, version, isLocked: doctors[0].is_locked };
  }

  async plan(doctorId: string) {
    return this.dataSource.transaction(async (em) => {
      await lockDoctor(em, doctorId);
      return this.readPlan(em, doctorId);
    });
  }

  private desiredTimes(plan: SchedulePlan, rules = plan.rules): string[] {
    if (plan.isLocked) return [];
    const closed = new Set(
      plan.exceptions.filter((e) => e.closed).map((e) => e.workDate),
    );
    return buildSlotTimes(rules, todayVn()).filter(
      (t) => !closed.has(t.slice(0, 10)),
    );
  }

  private async impacts(
    em: EntityManager,
    doctorId: string,
    before: SchedulePlan,
    rules: ScheduleRule[],
  ) {
    const changed = changedWeekdays(before.rules, rules);
    // Duration changes can overlap an existing booking even if its starting time survives.
    // Conservatively require bookings on changed weekdays to be resolved first.
    const conflicts: SlotConflict[] = changed.length
      ? await em.query(
          `SELECT id AS "slotId", to_char(slot_time,'YYYY-MM-DD HH24:MI:SS') AS "slotTime"
      FROM appointment_slots WHERE doctor_id = $1 AND status = 'booked'
      AND slot_time > now() AT TIME ZONE 'Asia/Ho_Chi_Minh'
      AND EXTRACT(ISODOW FROM slot_time)::int = ANY($2::int[]) ORDER BY slot_time`,
          [doctorId, changed],
        )
      : [];
    const desired = this.desiredTimes(before, rules);
    const rows = await em.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'available' AND NOT (slot_time = ANY($2::timestamp[])))::int AS close_count
      FROM appointment_slots WHERE doctor_id=$1 AND slot_time > now() AT TIME ZONE 'Asia/Ho_Chi_Minh'`,
      [doctorId, desired],
    );
    const openings = await em.query(
      `SELECT COUNT(*)::int AS count FROM unnest($2::timestamp[]) AS desired(t)
      WHERE desired.t > now() AT TIME ZONE 'Asia/Ho_Chi_Minh'
      AND NOT EXISTS (SELECT 1 FROM appointment_slots s WHERE s.doctor_id=$1 AND s.slot_time=desired.t AND s.status IN ('available','booked'))
      AND NOT EXISTS (SELECT 1 FROM doctor_leave_requests l WHERE l.doctor_id=$1 AND l.status='approved' AND desired.t::date BETWEEN l.start_date AND l.end_date)`,
      [doctorId, desired],
    );
    return {
      expectedVersion: before.version,
      version: before.version,
      changedWeekdays: changed,
      bookedConflicts: conflicts.length,
      conflicts,
      slotsToClose: rows[0]?.close_count ?? 0,
      slotsToOpen: openings[0]?.count ?? 0,
    };
  }

  async preview(doctorId: string, input: unknown) {
    const rules = validateRules(input);
    return this.dataSource.transaction(async (em) => {
      await lockDoctor(em, doctorId);
      return this.impacts(
        em,
        doctorId,
        await this.readPlan(em, doctorId),
        rules,
      );
    });
  }

  private assertConfirmed(
    body: Record<string, unknown>,
    plan: SchedulePlan,
  ): void {
    if (body.confirm !== true)
      throw new BadRequestException(
        'Vui lòng xem trước và xác nhận thay đổi lịch',
      );
    if (body.expectedVersion !== plan.version)
      throw new ConflictException(
        'Lịch đã thay đổi. Vui lòng tải lại và xem trước lần nữa',
      );
  }

  async saveRules(
    doctorId: string,
    actorId: string,
    body: Record<string, unknown>,
  ) {
    const rules = validateRules(body.rules);
    return this.dataSource.transaction(async (em) => {
      await lockDoctor(em, doctorId);
      const before = await this.readPlan(em, doctorId);
      this.assertConfirmed(body, before);
      const impact = await this.impacts(em, doctorId, before, rules);
      if (impact.bookedConflicts)
        throw new ConflictException({
          message:
            'Các ngày thay đổi còn lịch đã đặt. Đổi/hủy các lịch này trước khi sửa ca.',
          ...impact,
        });
      await em.query('DELETE FROM doctor_schedule_rules WHERE doctor_id=$1', [
        doctorId,
      ]);
      for (const rule of rules)
        await em.query(
          `INSERT INTO doctor_schedule_rules(doctor_id,weekday,start_time,end_time,interval_minutes)
        VALUES($1,$2,$3::time,$4::time,$5)`,
          [
            doctorId,
            rule.weekday,
            rule.startTime,
            rule.endTime,
            rule.intervalMinutes,
          ],
        );
      await this.generateLocked(em, doctorId, { ...before, rules });
      await this.audit(em, actorId, doctorId, 'schedule.updated', {
        previous: before.rules,
        rules,
      });
      return this.readPlan(em, doctorId);
    });
  }

  private exceptionInput(body: Record<string, unknown>) {
    const workDate = isoDate(body.workDate);
    if (workDate < todayVn() || workDate > addDays(todayVn(), 365))
      throw new BadRequestException('Ngày ngoại lệ phải trong 365 ngày tới');
    if (
      typeof body.closed !== 'boolean' ||
      typeof body.reason !== 'string' ||
      !body.reason.trim() ||
      body.reason.length > 1000
    ) {
      throw new BadRequestException(
        'Cần trạng thái đóng/mở và lý do tối đa 1000 ký tự',
      );
    }
    const reason = body.reason.trim();
    const closed = body.closed;
    return { workDate, reason, closed };
  }

  async previewException(doctorId: string, body: Record<string, unknown>) {
    const { workDate, closed } = this.exceptionInput(body);
    return this.dataSource.transaction(async (em) => {
      await lockDoctor(em, doctorId);
      const plan = await this.readPlan(em, doctorId);
      const slots = await em.query(
        `SELECT id AS "slotId", to_char(slot_time,'YYYY-MM-DD HH24:MI:SS') AS "slotTime", status
        FROM appointment_slots WHERE doctor_id=$1 AND slot_time::date=$2::date
        AND slot_time > now() AT TIME ZONE 'Asia/Ho_Chi_Minh' ORDER BY slot_time`,
        [doctorId, workDate],
      );
      const conflicts = closed
        ? slots.filter((s) => s.status === 'booked')
        : [];
      return {
        expectedVersion: plan.version,
        version: plan.version,
        workDate,
        closed,
        bookedConflicts: conflicts.length,
        conflicts,
        slotsToClose: closed
          ? slots.filter((s) => s.status === 'available').length
          : 0,
      };
    });
  }

  async setException(
    doctorId: string,
    actorId: string,
    body: Record<string, unknown>,
  ) {
    const { workDate, reason, closed } = this.exceptionInput(body);
    return this.dataSource.transaction(async (em) => {
      await lockDoctor(em, doctorId);
      const before = await this.readPlan(em, doctorId);
      this.assertConfirmed(body, before);
      if (closed) {
        const conflicts = await em.query(
          `SELECT id FROM appointment_slots WHERE doctor_id=$1 AND slot_time::date=$2::date
          AND slot_time > now() AT TIME ZONE 'Asia/Ho_Chi_Minh' AND status='booked'`,
          [doctorId, workDate],
        );
        if (conflicts.length)
          throw new ConflictException(
            'Ngày này còn lịch đã đặt. Đổi/hủy lịch trước khi đóng ca',
          );
      }
      await em.query(
        `INSERT INTO doctor_schedule_exceptions(doctor_id,work_date,closed,reason,updated_by)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(doctor_id,work_date) DO UPDATE SET closed=EXCLUDED.closed,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by`,
        [doctorId, workDate, closed, reason, actorId],
      );
      const after = await this.readPlan(em, doctorId);
      await this.generateLocked(em, doctorId, after);
      await this.audit(em, actorId, doctorId, 'schedule.exception', {
        workDate,
        closed,
        reason,
      });
      return after;
    });
  }

  private async audit(
    em: EntityManager,
    actorId: string,
    doctorId: string,
    action: string,
    detail: unknown,
  ) {
    await em.query(
      'INSERT INTO operation_audit(actor_id,action,entity_id,detail) VALUES($1,$2,$3,$4::jsonb)',
      [actorId, action, doctorId, JSON.stringify(detail)],
    );
  }

  /** Must run after the same doctor advisory lock used by booking and leave approval. */
  private async generateLocked(
    em: EntityManager,
    doctorId: string,
    plan: SchedulePlan,
  ) {
    const desired = this.desiredTimes(plan);
    await em.query(
      `UPDATE appointment_slots s SET status='on_leave' WHERE s.doctor_id=$1 AND s.status='available'
      AND s.slot_time > now() AT TIME ZONE 'Asia/Ho_Chi_Minh'
      AND (NOT (s.slot_time=ANY($2::timestamp[])) OR EXISTS (
        SELECT 1 FROM doctor_leave_requests l WHERE l.doctor_id=s.doctor_id AND l.status='approved' AND s.slot_time::date BETWEEN l.start_date AND l.end_date))`,
      [doctorId, desired],
    );
    const inserted = await em.query(
      `INSERT INTO appointment_slots(id,doctor_id,slot_time,status)
      SELECT gen_random_uuid(),$1,t,CASE WHEN EXISTS(SELECT 1 FROM doctor_leave_requests l
        WHERE l.doctor_id=$1 AND l.status='approved' AND t::date BETWEEN l.start_date AND l.end_date)
        THEN 'on_leave'::slot_status ELSE 'available'::slot_status END
      FROM unnest($2::timestamp[]) AS x(t) WHERE t > now() AT TIME ZONE 'Asia/Ho_Chi_Minh'
      ON CONFLICT(doctor_id,slot_time) DO NOTHING RETURNING id`,
      [doctorId, desired],
    );
    // Reopen only dates explicitly allowed by the current plan, never approved leave.
    await em.query(
      `UPDATE appointment_slots s SET status='available' WHERE s.doctor_id=$1 AND s.status='on_leave'
      AND s.slot_time=ANY($2::timestamp[]) AND s.slot_time > now() AT TIME ZONE 'Asia/Ho_Chi_Minh'
      AND NOT EXISTS(SELECT 1 FROM doctor_leave_requests l WHERE l.doctor_id=s.doctor_id
        AND l.status='approved' AND s.slot_time::date BETWEEN l.start_date AND l.end_date)`,
      [doctorId, desired],
    );
    return { inserted: inserted.length, daysAhead: SLOT_HORIZON_DAYS };
  }

  async generateForDoctor(doctorId: string) {
    return this.dataSource.transaction(async (em) => {
      await lockDoctor(em, doctorId);
      return this.generateLocked(
        em,
        doctorId,
        await this.readPlan(em, doctorId),
      );
    });
  }

  /** Called once for a newly created doctor; empty saved rules later mean intentionally closed. */
  async initializeDoctor(doctorId: string, manager?: EntityManager) {
    const initialize = async (em: EntityManager) => {
      await lockDoctor(em, doctorId);
      await em.query(
        `INSERT INTO doctor_schedule_rules(doctor_id,weekday,start_time,end_time)
        SELECT $1,d.day,t.start_time::time,t.end_time::time FROM generate_series(1,5) AS d(day)
        CROSS JOIN (VALUES ('08:00','11:30'),('13:00','17:00')) AS t(start_time,end_time) ON CONFLICT DO NOTHING`,
        [doctorId],
      );
      return this.generateLocked(
        em,
        doctorId,
        await this.readPlan(em, doctorId),
      );
    };
    return manager
      ? initialize(manager)
      : this.dataSource.transaction(initialize);
  }

  async generateAll() {
    const doctors = await this.dataSource.query(
      `SELECT id FROM users WHERE role='doctor' ORDER BY id`,
    );
    let processed = 0,
      failed = 0;
    for (const doctor of doctors) {
      try {
        await this.generateForDoctor(doctor.id);
        processed++;
      } catch (e) {
        failed++;
        this.logger.error(
          `Không sinh được lịch bác sĩ ${doctor.id}: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
    return { processed, failed };
  }

  async onModuleInit() {
    await this.generateAll();
  }
  @Cron('0 5 * * * *', {
    name: 'doctor-slot-horizon',
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async refreshHorizon() {
    await this.generateAll();
  }
}
