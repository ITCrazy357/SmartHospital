import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { MedicalRecordEntity } from '../models/medical-record.model';
import { AppointmentEntity } from '../models/appointment.model';
import { AppointmentSlotEntity } from '../models/appointment-slot.model';
import { lockDoctor } from '../common/doctor-lock';
import { UserEntity, type UserPublic } from '../models/user.model';
import { AppointmentStatus } from '../models/enums';
import { MedicalRecordEmbeddingsService } from './medical-record-embeddings.service';

export type DoctorPendingMedicalAppointmentDto = {
  id: string; version?: number;
  patientId: string;
  patientName: string;
  patientEmail: string;
  patientPhone: string | null;
  slotTime: string;
  appointmentSymptoms: string | null;
  status: string;
};

export type CreateMedicalRecordResultDto = {
  record: {
    id: string; version?: number;
    patientId: string;
    doctorId: string;
    appointmentId: string | null;
    symptoms: string | null;
    diagnosis: string | null;
    treatment: string | null;
    notes: string | null;
    createdAt: string;
  };
  embeddingStored: boolean;
};

export type DoctorMedicalRecordListItemDto = {
  id: string; version?: number;
  patientId: string;
  patientName: string;
  patientEmail: string;
  patientPhone: string | null;
  appointmentId: string | null;
  slotTime: string | null;
  symptoms: string | null;
  diagnosis: string | null;
  treatment: string | null;
  notes: string | null;
  createdAt: string;
};

/** Hồ sơ khám hiển thị cho bệnh nhân (chính chủ). */
export type PatientMedicalRecordDto = {
  id: string; version?: number;
  appointmentId: string | null;
  slotTime: string | null;
  doctor: {
    id: string; version?: number;
    fullName: string;
    avatarUrl: string | null;
    departmentName: string | null;
  } | null;
  symptoms: string | null;
  diagnosis: string | null;
  treatment: string | null;
  notes: string | null;
  createdAt: string;
};

export type DoctorStatsDto = {
  range: { from: string; to: string };
  totalRecords: number;
  totalRecordsAllTime: number;
  uniquePatients: number;
  uniquePatientsAllTime: number;
  pendingCount: number;
  /** 0..1 — số hồ sơ / số ca đủ điều kiện đã qua giờ trong khoảng */
  completionRate: number;
  byDay: { date: string; count: number }[];
  topDiagnoses: { keyword: string; count: number }[];
};

@Injectable()
export class MedicalRecordsService {
  private readonly logger = new Logger(MedicalRecordsService.name);

  constructor(
    @InjectRepository(MedicalRecordEntity)
    private readonly recordRepo: Repository<MedicalRecordEntity>,
    @InjectRepository(AppointmentEntity)
    private readonly appointmentRepo: Repository<AppointmentEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly embeddings: MedicalRecordEmbeddingsService,
  ) {}

  async listPendingForDoctor(doctorId: string): Promise<DoctorPendingMedicalAppointmentDto[]> {
    const now = new Date();
    const rows = await this.appointmentRepo
      .createQueryBuilder('a')
      .innerJoinAndSelect('a.slot', 'slot')
      .innerJoinAndSelect('a.user', 'patient')
      .leftJoin('medical_records', 'mr', 'mr.appointment_id = a.id')
      .where('a.doctorId = :doctorId', { doctorId })
      .andWhere('mr.id IS NULL')
      .andWhere("EXISTS (SELECT 1 FROM clinic_visits cv WHERE cv.appointment_id=a.id AND cv.status IN ('checked_in','in_consultation'))")
      .andWhere('slot.slotTime <= :now', { now })
      .andWhere(
        `(a.status IN (:...stOk) OR (a.status = :pending AND EXISTS (
          SELECT 1 FROM payments p WHERE p.appointment_id = a.id AND p.status = 'paid'
        )))`,
        {
          stOk: [AppointmentStatus.Confirmed, AppointmentStatus.Completed],
          pending: AppointmentStatus.Pending,
        },
      )
      .orderBy('slot.slot_time', 'DESC')
      .getMany();

    return rows.map((a) => {
      const patient = a.user as { fullName?: string; email?: string; phone?: string | null } | undefined;
      const slot = a.slot as { slotTime: Date } | undefined;
      return {
        id: a.id,
        patientId: a.userId,
        patientName: patient?.fullName ?? '',
        patientEmail: patient?.email ?? '',
        patientPhone: patient?.phone ?? null,
        slotTime: slot ? new Date(slot.slotTime).toISOString() : '',
        appointmentSymptoms: a.symptoms,
        status: a.status,
      };
    });
  }

  async createFromAppointment(
    doctorId: string,
    body: {
      appointmentId: string;
      symptoms?: string | null;
      diagnosis?: string | null;
      treatment?: string | null;
      notes?: string | null;
    },
  ): Promise<CreateMedicalRecordResultDto> {
    const appointmentId = body.appointmentId?.trim();
    if (!appointmentId) throw new BadRequestException('Thiếu appointmentId');

    const symptoms = body.symptoms?.trim() || null;
    const diagnosis = body.diagnosis?.trim() || null;
    const treatment = body.treatment?.trim() || null;
    const notes = body.notes?.trim() || null;

    const hasContent = [symptoms, diagnosis, treatment, notes].some((x) => x && x.length > 0);
    if (!hasContent) {
      throw new BadRequestException('Nhập ít nhất một trong: triệu chứng, chẩn đoán, điều trị, ghi chú');
    }

    const saved = await this.dataSource.transaction(async (em) => {
      await lockDoctor(em, doctorId);
      const appointment = await em.findOne(AppointmentEntity, {
        where: { id: appointmentId }, lock: { mode: 'pessimistic_write' },
      });
      if (!appointment) throw new NotFoundException('Không tìm thấy lịch hẹn');
      if (appointment.doctorId !== doctorId) throw new ForbiddenException('Không phải lịch của bạn');
      const existing = await em.findOne(MedicalRecordEntity, { where: { appointmentId } });
      if (existing) throw new ConflictException('Lịch hẹn đã có hồ sơ; vui lòng tải lại');
      if (appointment.status !== AppointmentStatus.Confirmed) throw new ConflictException('Lịch chưa được xác nhận hoặc đã kết thúc');
      const visit = await em.query(`SELECT id FROM clinic_visits WHERE appointment_id=$1
        AND status IN ('checked_in','in_consultation') FOR UPDATE`, [appointmentId]);
      if (!visit.length) throw new ConflictException('Bệnh nhân chưa được tiếp đón; không thể coi ca vắng là đã khám');
      const slot = appointment.slotId ? await em.findOne(AppointmentSlotEntity, { where: { id: appointment.slotId } }) : null;
      if (!slot || new Date(slot.slotTime).getTime() > Date.now()) throw new BadRequestException('Chưa đến ca khám');
      const record = await em.save(MedicalRecordEntity, {
        patientId: appointment.userId, doctorId, appointmentId, symptoms, diagnosis, treatment, notes,
        version: 1, embeddingStatus: 'pending',
      });
      appointment.status = AppointmentStatus.Completed;
      await em.save(appointment);
      await em.query("UPDATE clinic_visits SET status='completed', version=version+1, updated_at=now() WHERE appointment_id=$1", [appointmentId]);
      await em.query(`INSERT INTO medical_record_revisions(record_id,version,actor_id,reason,snapshot)
        VALUES($1,1,$2,'Tạo hồ sơ',$3)`, [record.id, doctorId, JSON.stringify(record)]);
      return record;
    });

    let embeddingStored = false;
    try {
      embeddingStored = await this.embeddings.embedRecord(saved.id);
    } catch (e) {
      this.logger.warn(`Không lưu embedding: ${e instanceof Error ? e.message : e}`);
    }

    return {
      record: {
        id: saved.id, version: saved.version,
        patientId: saved.patientId,
        doctorId: saved.doctorId,
        appointmentId: saved.appointmentId,
        symptoms: saved.symptoms,
        diagnosis: saved.diagnosis,
        treatment: saved.treatment,
        notes: saved.notes,
        createdAt: saved.createdAt.toISOString(),
      },
      embeddingStored,
    };
  }

  /**
   * Thống kê bệnh án cho bác sĩ trong khoảng [from, to] (ISO date YYYY-MM-DD, theo giờ VN).
   * Mặc định: 30 ngày gần đây.
   */
  async statsForDoctor(
    doctorId: string,
    fromIso?: string,
    toIso?: string,
  ): Promise<DoctorStatsDto> {
    const reIso = /^\d{4}-\d{2}-\d{2}$/;
    const todayDate = new Date();
    const todayStr = isoDateOnlyVN(todayDate);
    const defaultFrom = isoDateOnlyVN(new Date(todayDate.getTime() - 29 * 86_400_000));
    const from = fromIso && reIso.test(fromIso) ? fromIso : defaultFrom;
    const to = toIso && reIso.test(toIso) ? toIso : todayStr;
    if (from > to) {
      throw new BadRequestException('from phải <= to');
    }

    const TZ = 'Asia/Ho_Chi_Minh';

    const allTime = (await this.dataSource.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(DISTINCT patient_id)::int AS unique_patients
       FROM medical_records WHERE doctor_id = $1`,
      [doctorId],
    )) as { total: number | string; unique_patients: number | string }[];

    const inRange = (await this.dataSource.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(DISTINCT patient_id)::int AS unique_patients
       FROM medical_records
       WHERE doctor_id = $1
         AND created_at >= ($2::date AT TIME ZONE $4)
         AND created_at <  (($3::date + INTERVAL '1 day') AT TIME ZONE $4)`,
      [doctorId, from, to, TZ],
    )) as { total: number | string; unique_patients: number | string }[];

    const byDayRows = (await this.dataSource.query(
      `SELECT
         to_char((created_at AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS day,
         COUNT(*)::int AS count
       FROM medical_records
       WHERE doctor_id = $1
         AND created_at >= ($2::date AT TIME ZONE $4)
         AND created_at <  (($3::date + INTERVAL '1 day') AT TIME ZONE $4)
       GROUP BY day
       ORDER BY day ASC`,
      [doctorId, from, to, TZ],
    )) as { day: string; count: number | string }[];

    const topRows = (await this.dataSource.query(
      `SELECT
         lower(btrim(diagnosis)) AS keyword,
         COUNT(*)::int AS count
       FROM medical_records
       WHERE doctor_id = $1
         AND diagnosis IS NOT NULL
         AND btrim(diagnosis) <> ''
         AND created_at >= ($2::date AT TIME ZONE $4)
         AND created_at <  (($3::date + INTERVAL '1 day') AT TIME ZONE $4)
       GROUP BY lower(btrim(diagnosis))
       ORDER BY count DESC, keyword ASC
       LIMIT 10`,
      [doctorId, from, to, TZ],
    )) as { keyword: string; count: number | string }[];

    const eligRow = (await this.dataSource.query(
      `WITH eligible AS (
         SELECT a.id
         FROM appointments a
         INNER JOIN appointment_slots s ON s.id = a.slot_id
         WHERE a.doctor_id = $1
           AND s.slot_time >= $2::date
           AND s.slot_time <  ($3::date + INTERVAL '1 day')
           AND s.slot_time <= NOW()
           AND (
             a.status IN ('confirmed', 'completed')
             OR (a.status = 'pending' AND EXISTS (
               SELECT 1 FROM payments p WHERE p.appointment_id = a.id AND p.status = 'paid'
             ))
           )
       )
       SELECT
         (SELECT COUNT(*) FROM eligible)::int AS eligible,
         (SELECT COUNT(*) FROM eligible e
            INNER JOIN medical_records mr ON mr.appointment_id = e.id)::int AS with_record`,
      [doctorId, from, to],
    )) as { eligible: number | string; with_record: number | string }[];

    const eligible = Number(eligRow[0]?.eligible ?? 0);
    const withRecord = Number(eligRow[0]?.with_record ?? 0);
    const completionRate = eligible > 0 ? withRecord / eligible : 0;

    const pending = await this.listPendingForDoctor(doctorId);
    const pendingCount = pending.length;

    const byDayMap = new Map<string, number>();
    for (const r of byDayRows) byDayMap.set(r.day, Number(r.count));
    const byDay: { date: string; count: number }[] = [];
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
      const ds = isoDateOnlyVN(d);
      byDay.push({ date: ds, count: byDayMap.get(ds) ?? 0 });
    }

    return {
      range: { from, to },
      totalRecords: Number(inRange[0]?.total ?? 0),
      totalRecordsAllTime: Number(allTime[0]?.total ?? 0),
      uniquePatients: Number(inRange[0]?.unique_patients ?? 0),
      uniquePatientsAllTime: Number(allTime[0]?.unique_patients ?? 0),
      pendingCount,
      completionRate,
      byDay,
      topDiagnoses: topRows.map((r) => ({ keyword: r.keyword, count: Number(r.count) })),
    };
  }

  // ============ Patient view ============

  /**
   * Danh sách hồ sơ khám của chính bệnh nhân (sắp xếp mới nhất trước).
   * Kèm thông tin bác sĩ + thời gian ca khám.
   */
  async listForPatient(patientId: string): Promise<PatientMedicalRecordDto[]> {
    const rows = await this.recordRepo.find({
      where: { patientId },
      relations: ['doctor', 'doctor.department', 'appointment', 'appointment.slot'],
      order: { createdAt: 'DESC' },
      take: 200,
    });
    return rows.map((r) => this.toPatientDto(r));
  }

  /**
   * Lấy hồ sơ khám theo appointmentId — chỉ trả nếu thuộc chính bệnh nhân.
   * Dùng cho nút "Xem kết quả khám" trong tab Lịch sử khám.
   */
  async getByAppointmentForPatient(
    patientId: string,
    appointmentId: string,
  ): Promise<PatientMedicalRecordDto> {
    const record = await this.recordRepo.findOne({
      where: { appointmentId, patientId },
      relations: ['doctor', 'doctor.department', 'appointment', 'appointment.slot'],
    });
    if (!record) {
      throw new NotFoundException('Lịch hẹn này chưa có kết quả khám');
    }
    return this.toPatientDto(record);
  }

  private toPatientDto(r: MedicalRecordEntity): PatientMedicalRecordDto {
    const doctor = r.doctor as
      | (UserEntity & { department?: { name?: string } | null })
      | undefined;
    const slot = r.appointment?.slot;
    const slotTime = slot?.slotTime ? new Date(slot.slotTime).toISOString() : null;
    return {
      id: r.id, version: r.version,
      appointmentId: r.appointmentId,
      slotTime,
      doctor: doctor
        ? {
            id: doctor.id,
            fullName: doctor.fullName ?? '',
            avatarUrl: doctor.avatarUrl ?? null,
            departmentName: doctor.department?.name ?? null,
          }
        : null,
      symptoms: r.symptoms,
      diagnosis: r.diagnosis,
      treatment: r.treatment,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async listMyRecords(doctorId: string): Promise<DoctorMedicalRecordListItemDto[]> {
    const rows = await this.recordRepo.find({
      where: { doctorId },
      relations: ['patient', 'appointment', 'appointment.slot'],
      order: { createdAt: 'DESC' },
      take: 200,
    });
    return rows.map((r) => this.toDoctorRecordItem(r));
  }

  /** Lấy chi tiết 1 hồ sơ của bác sĩ — dùng khi click "Xem hồ sơ" từ kết quả AI. */
  async getMyRecordById(
    doctorId: string,
    recordId: string,
  ): Promise<DoctorMedicalRecordListItemDto> {
    const record = await this.recordRepo.findOne({
      where: { id: recordId, doctorId },
      relations: ['patient', 'appointment', 'appointment.slot'],
    });
    if (!record) {
      throw new NotFoundException('Không tìm thấy hồ sơ hoặc không thuộc bạn');
    }
    return this.toDoctorRecordItem(record);
  }

  private toDoctorRecordItem(r: MedicalRecordEntity): DoctorMedicalRecordListItemDto {
    const patient = r.patient;
    const slot = r.appointment?.slot;
    const slotTime = slot?.slotTime ? new Date(slot.slotTime).toISOString() : null;
    return {
      id: r.id, version: r.version,
      patientId: r.patientId,
      patientName: patient?.fullName ?? '',
      patientEmail: patient?.email ?? '',
      patientPhone: patient?.phone ?? null,
      appointmentId: r.appointmentId,
      slotTime,
      symptoms: r.symptoms,
      diagnosis: r.diagnosis,
      treatment: r.treatment,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async updateMyRecord(
    doctorId: string,
    recordId: string,
    body: {
      version?: number; reason?: string; symptoms?: string | null;
      diagnosis?: string | null;
      treatment?: string | null;
      notes?: string | null;
    },
  ): Promise<CreateMedicalRecordResultDto> {
    if (!Number.isInteger(body.version) || !body.reason?.trim())
      throw new BadRequestException('Cần phiên bản hồ sơ và lý do chỉnh sửa');
    const saved = await this.dataSource.transaction(async em => {
      await lockDoctor(em, doctorId);
      const record = await em.findOne(MedicalRecordEntity, { where: { id: recordId, doctorId }, lock: { mode: 'pessimistic_write' } });
      if (!record) throw new NotFoundException('Không tìm thấy hồ sơ hoặc không thuộc bạn');
      const structured=await em.query(`SELECT 1 FROM clinic_encounters e JOIN clinic_visits v ON v.id=e.visit_id
        WHERE v.appointment_id=$1 AND e.status='final'`,[record.appointmentId]);
      if(structured.length)throw new ConflictException('Hồ sơ có cấu trúc: mở ca khám trong Phòng khám để sửa và giữ đầy đủ lịch sử');
      if (record.version !== body.version) throw new ConflictException('Hồ sơ đã thay đổi; tải lại trước khi sửa');
      for (const key of ['symptoms','diagnosis','treatment','notes'] as const) {
        const value = body[key];
        if (value !== undefined) {
          if (value !== null && (typeof value !== 'string' || value.length > 10000)) throw new BadRequestException('Nội dung không hợp lệ');
          record[key] = value?.trim() || null;
        }
      }
      if (![record.symptoms,record.diagnosis,record.treatment,record.notes].some(Boolean)) throw new BadRequestException('Hồ sơ không được rỗng');
      record.version++; record.updatedAt=new Date(); record.embeddingStatus='pending';
      const updated=await em.save(record);
      await em.query(`INSERT INTO medical_record_revisions(record_id,version,actor_id,reason,snapshot) VALUES($1,$2,$3,$4,$5)`,
        [recordId,updated.version,doctorId,body.reason!.trim().slice(0,1000),JSON.stringify(updated)]);
      // Old embeddings must not remain searchable after an edit until refreshed.
      await em.query('DELETE FROM medical_record_embeddings WHERE record_id=$1',[recordId]);
      return updated;
    });

    let embeddingStored = false;
    try {
      embeddingStored = await this.embeddings.embedRecord(saved.id);
    } catch (e) {
      this.logger.warn(`Không cập nhật embedding: ${e instanceof Error ? e.message : e}`);
    }

    return {
      record: {
        id: saved.id, version: saved.version,
        patientId: saved.patientId,
        doctorId: saved.doctorId,
        appointmentId: saved.appointmentId,
        symptoms: saved.symptoms,
        diagnosis: saved.diagnosis,
        treatment: saved.treatment,
        notes: saved.notes,
        createdAt: saved.createdAt.toISOString(),
      },
      embeddingStored,
    };
  }

  private toUserPublic(u: UserEntity): UserPublic {
    return {
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      phone: u.phone,
      role: u.role,
      avatarUrl: u.avatarUrl ?? null,
    };
  }

  async revisionsForDoctor(doctorId:string,recordId:string){
    const record=await this.recordRepo.findOne({where:{id:recordId,doctorId}});
    if(!record)throw new NotFoundException('Không tìm thấy hồ sơ hoặc không thuộc bạn');
    return this.dataSource.query(`SELECT r.version,r.reason,r.snapshot,r.created_at,u.full_name AS actor_name
      FROM medical_record_revisions r JOIN users u ON u.id=r.actor_id WHERE r.record_id=$1 ORDER BY r.version DESC LIMIT 100`,[recordId]);
  }

}

function isoDateOnlyVN(d: Date): string {
  const vn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return vn.toISOString().slice(0, 10);
}
