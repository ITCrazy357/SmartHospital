import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DoctorLeaveRequestEntity } from '../models/doctor-leave-request.model';
import { AppointmentSlotEntity } from '../models/appointment-slot.model';
import { UserEntity } from '../models/user.model';
import { LeaveRequestStatus, SlotStatus } from '../models/enums';
import {
  isWeekendIsoDate,
  listWeekdayIsoDatesInRange,
} from '../common/weekday-calendar';
import { lockDoctor } from '../common/doctor-lock';
import { isoDate, todayVn } from '../schedules/schedule.rules';

const MAX_LEAVE_RANGE_DAYS = 60;

function dateColToIso(v: string | Date): string {
  if (typeof v === 'string') return v.slice(0, 10);
  return v.toISOString().slice(0, 10);
}

export type LeaveRequestRow = {
  id: string;
  doctorId: string;
  doctorName: string;
  doctorEmail: string;
  startDate: string;
  endDate: string;
  /** Chỉ các ngày T2–T6 trong khoảng (không gồm T7/CN) — dùng hiển thị & logic nghỉ */
  workdaysInRange: string[];
  reason: string | null;
  status: LeaveRequestStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
};

@Injectable()
export class LeaveRequestsService {
  constructor(
    @InjectRepository(DoctorLeaveRequestEntity)
    private readonly leaveRepo: Repository<DoctorLeaveRequestEntity>,
    @InjectRepository(AppointmentSlotEntity)
    private readonly slotRepo: Repository<AppointmentSlotEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly dataSource: DataSource,
  ) {}

  private parseIsoDate(label: string, raw: string): string {
    return isoDate(raw, label);
  }

  private daysBetweenInclusive(start: string, end: string): number {
    const a = new Date(start + 'T12:00:00Z').getTime();
    const b = new Date(end + 'T12:00:00Z').getTime();
    return Math.floor((b - a) / 86400000) + 1;
  }

  private toRow(
    r: DoctorLeaveRequestEntity,
    doctorName: string,
    doctorEmail: string,
  ): LeaveRequestRow {
    const sd = dateColToIso(r.startDate as string | Date);
    const ed = dateColToIso(r.endDate as string | Date);
    return {
      id: r.id,
      doctorId: r.doctorId,
      doctorName,
      doctorEmail,
      startDate: sd,
      endDate: ed,
      workdaysInRange: listWeekdayIsoDatesInRange(sd, ed),
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      reviewedBy: r.reviewedBy,
    };
  }

  async createForDoctor(
    doctorId: string,
    body: { startDate: string; endDate: string; reason?: string | null },
  ): Promise<LeaveRequestRow> {
    const startDate = this.parseIsoDate('startDate', body.startDate);
    const endDate = this.parseIsoDate('endDate', body.endDate);
    if (startDate > endDate) {
      throw new BadRequestException('startDate không được sau endDate');
    }
    if (isWeekendIsoDate(startDate)) {
      throw new BadRequestException(
        'Ngày bắt đầu phải là thứ 2 – thứ 6 (không chọn thứ 7 hoặc chủ nhật).',
      );
    }
    if (isWeekendIsoDate(endDate)) {
      throw new BadRequestException(
        'Ngày kết thúc phải là thứ 2 – thứ 6 (không chọn thứ 7 hoặc chủ nhật).',
      );
    }
    const workdays = listWeekdayIsoDatesInRange(startDate, endDate);
    if (workdays.length === 0) {
      throw new BadRequestException(
        'Khoảng ngày không có ngày làm việc nào (chỉ áp dụng thứ 2 – thứ 6).',
      );
    }
    const today = todayVn();
    if (endDate < today) {
      throw new BadRequestException(
        'Khoảng nghỉ không được hoàn toàn trong quá khứ',
      );
    }
    const span = this.daysBetweenInclusive(startDate, endDate);
    if (span > MAX_LEAVE_RANGE_DAYS) {
      throw new BadRequestException(
        `Tối đa ${MAX_LEAVE_RANGE_DAYS} ngày mỗi đơn`,
      );
    }

    return this.dataSource.transaction(async (em) => {
      await lockDoctor(em, doctorId);
      const doctor = await em.findOne(UserEntity, {
        where: { id: doctorId, role: 'doctor', isLocked: false },
      });
      if (!doctor)
        throw new NotFoundException('Không tìm thấy bác sĩ hoạt động');
      const overlap = await em
        .getRepository(DoctorLeaveRequestEntity)
        .createQueryBuilder('r')
        .where('r.doctorId = :doctorId', { doctorId })
        .andWhere('r.status IN (:...st)', {
          st: [LeaveRequestStatus.Pending, LeaveRequestStatus.Approved],
        })
        .andWhere('r.startDate <= CAST(:end AS date)', { end: endDate })
        .andWhere('r.endDate >= CAST(:start AS date)', { start: startDate })
        .getOne();
      if (overlap) {
        throw new ConflictException(
          'Bạn đã có đơn chờ duyệt/đã duyệt trùng khoảng ngày này',
        );
      }

      const entity = em.create(DoctorLeaveRequestEntity, {
        doctorId,
        startDate,
        endDate,
        reason: body.reason?.trim() || null,
        status: LeaveRequestStatus.Pending,
        reviewedBy: null,
        reviewedAt: null,
      });
      const saved = await em.save(entity);
      const name = doctor?.fullName ?? '';
      const email = doctor?.email ?? '';
      return this.toRow(saved, name, email);
    });
  }

  async listForDoctor(doctorId: string): Promise<LeaveRequestRow[]> {
    const rows = await this.leaveRepo.find({
      where: { doctorId },
      order: { createdAt: 'DESC' },
    });
    const doctor = await this.userRepo.findOne({ where: { id: doctorId } });
    const name = doctor?.fullName ?? '';
    const email = doctor?.email ?? '';
    return rows.map((r) => this.toRow(r, name, email));
  }

  async listForAdmin(status?: LeaveRequestStatus): Promise<LeaveRequestRow[]> {
    const qb = this.leaveRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.doctor', 'd')
      .orderBy('r.createdAt', 'DESC');
    if (status) {
      qb.andWhere('r.status = :status', { status });
    }
    const rows = await qb.getMany();
    return rows.map((r) => {
      const d = r.doctor as UserEntity | undefined;
      return this.toRow(r, d?.fullName ?? '', d?.email ?? '');
    });
  }

  async approve(requestId: string, adminId: string): Promise<LeaveRequestRow> {
    const existing = await this.leaveRepo.findOne({ where: { id: requestId } });
    if (!existing) throw new NotFoundException('Không tìm thấy đơn');
    return this.dataSource.transaction(async (em) => {
      await lockDoctor(em, existing.doctorId);
      const req = await em.findOne(DoctorLeaveRequestEntity, {
        where: { id: requestId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!req) throw new NotFoundException('Không tìm thấy đơn');
      if (req.status !== LeaveRequestStatus.Pending) {
        throw new BadRequestException('Đơn không còn ở trạng thái chờ duyệt');
      }

      const startDate = dateColToIso(req.startDate as string | Date);
      const endDate = dateColToIso(req.endDate as string | Date);

      const booked = await em
        .getRepository(AppointmentSlotEntity)
        .createQueryBuilder('s')
        .where('s.doctorId = :doctorId', { doctorId: req.doctorId })
        .andWhere('s.status = :booked', { booked: SlotStatus.Booked })
        .andWhere("s.slotTime > now() AT TIME ZONE 'Asia/Ho_Chi_Minh'")
        .andWhere(
          'CAST(s.slotTime AS DATE) BETWEEN CAST(:start AS date) AND CAST(:end AS date)',
          { start: startDate, end: endDate },
        )
        .getCount();
      if (booked > 0) {
        throw new ConflictException(
          'Trong khoảng ngày này vẫn còn ca đã có bệnh nhân đặt. Không thể duyệt nghỉ phép cho đến khi xử lý các lịch đó.',
        );
      }

      await em
        .getRepository(AppointmentSlotEntity)
        .createQueryBuilder()
        .update(AppointmentSlotEntity)
        .set({ status: SlotStatus.OnLeave })
        .where('doctorId = :doctorId', { doctorId: req.doctorId })
        .andWhere('status = :av', { av: SlotStatus.Available })
        .andWhere(
          'CAST(slotTime AS DATE) BETWEEN CAST(:start AS date) AND CAST(:end AS date)',
          { start: startDate, end: endDate },
        )
        .execute();

      req.status = LeaveRequestStatus.Approved;
      req.reviewedBy = adminId;
      req.reviewedAt = new Date();
      await em.save(req);
      await em.query(
        'INSERT INTO operation_audit(actor_id,action,entity_id,detail) VALUES($1,$2,$3,$4::jsonb)',
        [
          adminId,
          'leave.approved',
          req.id,
          JSON.stringify({ doctorId: req.doctorId, startDate, endDate }),
        ],
      );
      const d = await em.findOne(UserEntity, { where: { id: req.doctorId } });
      return this.toRow(req, d?.fullName ?? '', d?.email ?? '');
    });
  }

  async reject(requestId: string, adminId: string): Promise<LeaveRequestRow> {
    const existing = await this.leaveRepo.findOne({ where: { id: requestId } });
    if (!existing) throw new NotFoundException('Không tìm thấy đơn');
    return this.dataSource.transaction(async (em) => {
      await lockDoctor(em, existing.doctorId);
      const req = await em.findOne(DoctorLeaveRequestEntity, {
        where: { id: requestId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!req) throw new NotFoundException('Không tìm thấy đơn');
      if (req.status !== LeaveRequestStatus.Pending) {
        throw new BadRequestException('Đơn không còn ở trạng thái chờ duyệt');
      }
      req.status = LeaveRequestStatus.Rejected;
      req.reviewedBy = adminId;
      req.reviewedAt = new Date();
      await em.save(req);
      await em.query(
        'INSERT INTO operation_audit(actor_id,action,entity_id,detail) VALUES($1,$2,$3,$4::jsonb)',
        [
          adminId,
          'leave.rejected',
          req.id,
          JSON.stringify({ doctorId: req.doctorId }),
        ],
      );
      const d = await em.findOne(UserEntity, { where: { id: req.doctorId } });
      return this.toRow(req, d?.fullName ?? '', d?.email ?? '');
    });
  }
}
