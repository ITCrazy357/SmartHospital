import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../models/user.model';
import { DoctorScheduleEntity } from '../models/doctor-schedule.model';
import { AppointmentSlotEntity } from '../models/appointment-slot.model';
import { AppointmentEntity } from '../models/appointment.model';
import { AppointmentStatus } from '../models/enums';
import { sqlSlotNotInLunchBreak } from '../common/doctor-slot-hours';
import { publicDoctor, type PublicDoctorDto } from './public-doctor.dto';

/** GET /doctor/me/patients — bệnh nhân từng đặt lịch với bác sĩ. */
export interface DoctorPatientDto {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  totalAppointments: number;
  completedAppointments: number;
  upcomingAppointments: number;
  lastVisitAt: string | null;
  nextAppointmentAt: string | null;
  /** Đã từng có hồ sơ khám với bác sĩ này */
  hasMedicalRecord: boolean;
}

/** GET /doctor/me/appointments — lịch hẹn theo khoảng ngày, kèm thông tin bệnh nhân và slot. */
export interface DoctorAppointmentDto {
  id: string;
  status: string;
  symptoms: string | null;
  depositAmount: number | null;
  createdAt: string;
  slot: { id: string; slotTime: string } | null;
  patient: {
    id: string;
    fullName: string;
    email: string;
    phone: string | null;
    avatarUrl: string | null;
  } | null;
  hasMedicalRecord: boolean;
}

@Injectable()
export class DoctorsService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(DoctorScheduleEntity)
    private readonly scheduleRepo: Repository<DoctorScheduleEntity>,
    @InjectRepository(AppointmentSlotEntity)
    private readonly slotRepo: Repository<AppointmentSlotEntity>,
    @InjectRepository(AppointmentEntity)
    private readonly appointmentRepo: Repository<AppointmentEntity>,
  ) {}

  async findAll(departmentId?: string): Promise<PublicDoctorDto[]> {
    const qb = this.userRepo
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.department', 'department')
      .where("u.role = 'doctor'")
      .andWhere('u.isLocked = :isLocked', { isLocked: false })
      .orderBy('u.fullName', 'ASC');
    if (departmentId) {
      qb.andWhere('u.departmentId = :departmentId', { departmentId });
    }
    return (await qb.getMany()).map(publicDoctor);
  }

  async findOne(id: string): Promise<PublicDoctorDto | null> {
    const user = await this.userRepo.findOne({
      where: { id, role: 'doctor', isLocked: false },
      relations: { department: true },
    });
    if (!user) return null;
    return publicDoctor(user);
  }

  async findSchedulesByDoctor(
    doctorId: string,
    workDay?: string,
  ): Promise<DoctorScheduleEntity[]> {
    const qb = this.scheduleRepo
      .createQueryBuilder('s')
      .where('s.doctorId = :doctorId', { doctorId })
      .orderBy('s.workDay', 'ASC')
      .addOrderBy('s.startTime', 'ASC');
    if (workDay) {
      qb.andWhere('s.workDay = :workDay', { workDay });
    }
    return qb.getMany();
  }

  /** Slot đặt lịch của bác sĩ. onlyAvailable: true = chỉ slot còn trống (cho booking). */
  async findSlotsByDoctor(
    doctorId: string,
    fromDate?: string,
    onlyAvailable = false,
  ): Promise<AppointmentSlotEntity[]> {
    const qb = this.slotRepo
      .createQueryBuilder('s')
      .where('s.doctorId = :doctorId', { doctorId })
      .orderBy('s.slotTime', 'ASC');
    if (fromDate) {
      qb.andWhere('s.slotTime >= :fromDate', { fromDate });
    }
    if (onlyAvailable) {
      qb.andWhere('s.status = :status', { status: 'available' });
      qb.andWhere(sqlSlotNotInLunchBreak('s'));
    } else {
      // Ẩn slot trống trong giờ nghỉ trưa (dữ liệu cũ); vẫn hiện slot đã đặt nếu có.
      qb.andWhere(
        `(s.status != 'available' OR ${sqlSlotNotInLunchBreak('s')})`,
      );
    }
    return qb.getMany();
  }

  /**
   * Danh sách bệnh nhân đã từng đặt lịch với bác sĩ này.
   * Tổng hợp: tổng lượt, lượt đã hoàn tất, lượt sắp tới, lần khám gần nhất, lịch sắp tới gần nhất.
   * Sắp xếp: lịch sắp tới sớm nhất trước → còn lại sort theo lần khám gần nhất.
   */
  async findMyPatients(doctorId: string): Promise<DoctorPatientDto[]> {
    const rows = await this.appointmentRepo
      .createQueryBuilder('a')
      .innerJoin('a.user', 'u')
      .leftJoin('a.slot', 's')
      .leftJoin(
        'medical_records',
        'mr',
        'mr.appointment_id = a.id AND mr.doctor_id = :docId',
        {
          docId: doctorId,
        },
      )
      .select('u.id', 'patient_id')
      .addSelect('u.full_name', 'full_name')
      .addSelect('u.email', 'email')
      .addSelect('u.phone', 'phone')
      .addSelect('u.avatar_url', 'avatar_url')
      .addSelect('COUNT(DISTINCT a.id)', 'total_appointments')
      .addSelect(
        `COUNT(DISTINCT CASE WHEN a.status = 'completed' THEN a.id END)`,
        'completed_appointments',
      )
      .addSelect(
        `COUNT(DISTINCT CASE WHEN s.slot_time >= now() AND a.status IN ('confirmed', 'pending') THEN a.id END)`,
        'upcoming_appointments',
      )
      .addSelect(
        `MAX(CASE WHEN s.slot_time < now() OR a.status = 'completed' THEN s.slot_time END)`,
        'last_visit_at',
      )
      .addSelect(
        `MIN(CASE WHEN s.slot_time >= now() AND a.status IN ('confirmed', 'pending') THEN s.slot_time END)`,
        'next_appointment_at',
      )
      .addSelect(`BOOL_OR(mr.id IS NOT NULL)`, 'has_medical_record')
      .where('a.doctor_id = :doctorId', { doctorId })
      .groupBy('u.id')
      .addGroupBy('u.full_name')
      .addGroupBy('u.email')
      .addGroupBy('u.phone')
      .addGroupBy('u.avatar_url')
      .orderBy('next_appointment_at', 'ASC', 'NULLS LAST')
      .addOrderBy('last_visit_at', 'DESC', 'NULLS LAST')
      .addOrderBy('u.full_name', 'ASC')
      .getRawMany<{
        patient_id: string;
        full_name: string;
        email: string;
        phone: string | null;
        avatar_url: string | null;
        total_appointments: string;
        completed_appointments: string;
        upcoming_appointments: string;
        last_visit_at: Date | null;
        next_appointment_at: Date | null;
        has_medical_record: boolean | null;
      }>();

    return rows.map((r) => ({
      id: r.patient_id,
      fullName: r.full_name ?? '',
      email: r.email ?? '',
      phone: r.phone ?? null,
      avatarUrl: r.avatar_url ?? null,
      totalAppointments: Number(r.total_appointments ?? 0),
      completedAppointments: Number(r.completed_appointments ?? 0),
      upcomingAppointments: Number(r.upcoming_appointments ?? 0),
      lastVisitAt: r.last_visit_at
        ? new Date(r.last_visit_at).toISOString()
        : null,
      nextAppointmentAt: r.next_appointment_at
        ? new Date(r.next_appointment_at).toISOString()
        : null,
      hasMedicalRecord: Boolean(r.has_medical_record),
    }));
  }

  /**
   * Lịch hẹn của bác sĩ trong khoảng ngày [from, to] (theo slot.slotTime).
   * Bao gồm thông tin bệnh nhân + slot. Mặc định: 7 ngày kể từ hôm nay nếu thiếu tham số.
   * Không trả lịch đã huỷ — dashboard chỉ hiển thị lịch còn hiệu lực (pending/confirmed/completed).
   */
  async findMyAppointmentsByRange(
    doctorId: string,
    fromDate?: string,
    toDate?: string,
  ): Promise<DoctorAppointmentDto[]> {
    const qb = this.appointmentRepo
      .createQueryBuilder('a')
      .innerJoinAndSelect('a.slot', 'slot')
      .innerJoinAndSelect('a.user', 'patient')
      .leftJoin('medical_records', 'mr', 'mr.appointment_id = a.id')
      .addSelect('mr.id', 'mr_id')
      .where('a.doctorId = :doctorId', { doctorId })
      .andWhere('a.status != :cancelled', {
        cancelled: AppointmentStatus.Cancelled,
      });

    if (fromDate) {
      qb.andWhere('slot.slot_time >= :from', { from: `${fromDate} 00:00:00` });
    }
    if (toDate) {
      qb.andWhere('slot.slot_time <= :to', { to: `${toDate} 23:59:59` });
    }
    qb.orderBy('slot.slot_time', 'ASC');

    const result = await qb.getRawAndEntities();
    const idToMr = new Map<string, string | null>();
    for (const raw of result.raw as { a_id: string; mr_id: string | null }[]) {
      idToMr.set(raw.a_id, raw.mr_id);
    }

    return result.entities.map((a) => {
      const patient = a.user as
        | {
            id?: string;
            fullName?: string;
            email?: string;
            phone?: string | null;
            avatarUrl?: string | null;
          }
        | undefined;
      const slot = a.slot as { id?: string; slotTime: Date } | null | undefined;
      return {
        id: a.id,
        status: a.status,
        symptoms: a.symptoms,
        depositAmount: a.depositAmount != null ? Number(a.depositAmount) : null,
        createdAt: a.createdAt.toISOString(),
        slot: slot
          ? {
              id: slot.id ?? '',
              slotTime: new Date(slot.slotTime).toISOString(),
            }
          : null,
        patient: patient
          ? {
              id: patient.id ?? '',
              fullName: patient.fullName ?? '',
              email: patient.email ?? '',
              phone: patient.phone ?? null,
              avatarUrl: patient.avatarUrl ?? null,
            }
          : null,
        hasMedicalRecord: Boolean(idToMr.get(a.id)),
      };
    });
  }
}
