import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { UserEntity, UserPublic } from '../models/user.model';
import { normalizeVnPhone, validateStrongPassword } from '../common/patient-account.validation';
import { MailService } from '../auth/mail.service';
import { AppointmentSlotEntity } from '../models/appointment-slot.model';
import { AppointmentEntity } from '../models/appointment.model';
import { MedicalRecordEntity } from '../models/medical-record.model';
import type { UserRole } from '../models/user.model';
import { PaymentStatus } from '../models/enums';
import { SchedulesService } from '../schedules/schedules.service';

const STATS_TZ = 'Asia/Ho_Chi_Minh';

/** GET /admin/payments — một dòng giao dịch */
export interface AdminPaymentRowDto {
  id: string;
  amount: number;
  paymentType: string | null;
  paymentMethod: string | null;
  status: PaymentStatus;
  createdAt: string;
  payosOrderCode: number | null;
  appointmentId: string;
  appointmentStatus: string;
  patient: { id: string; fullName: string; email: string };
  doctor: { id: string; fullName: string };
  slotTime: string | null;
}

/** GET /admin/stats/overview */
export interface AdminStatsOverviewDto {
  range: { from: string; to: string };
  /** Tổng tiền các giao dịch status=paid trong khoảng */
  totalRevenuePaid: number;
  paymentCounts: { pending: number; paid: number; failed: number };
  appointmentsInRange: number;
  /** BN có ít nhất một lịch hẹn được tạo trong khoảng (distinct user_id) */
  distinctPatientsWithAppointmentInRange: number;
  /** Tổng tài khoản role=user */
  patientAccountsTotal: number;
  /** Tài khoản BN đăng ký mới trong khoảng */
  newPatientRegistrationsInRange: number;
  revenueByDay: { date: string; total: number }[];
}

const SALT_ROUNDS = 10;


@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(AppointmentSlotEntity)
    private readonly slotRepo: Repository<AppointmentSlotEntity>,
    @InjectRepository(AppointmentEntity)
    private readonly appointmentRepo: Repository<AppointmentEntity>,
    @InjectRepository(MedicalRecordEntity)
    private readonly medicalRecordRepo: Repository<MedicalRecordEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly mail: MailService,
    private readonly schedules: SchedulesService = new SchedulesService(dataSource),
  ) {}

  async createDoctor(
    dto: {
      email: string;
      password: string;
      fullName: string;
      phone?: string;
      departmentId?: string | null;
      bio?: string | null;
      experienceYears?: number | null;
      university?: string | null;
    },
    avatarUrl?: string | null,
  ): Promise<UserPublic> {
    const pwdErr = validateStrongPassword(dto.password ?? '');
    if (pwdErr) {
      throw new BadRequestException({ errors: { password: pwdErr } });
    }
    const emailNorm = dto.email.trim().toLowerCase();
    const existing = await this.userRepo.findOne({
      where: { email: emailNorm },
    });
    if (existing) {
      throw new ConflictException('Email đã được sử dụng');
    }
    const phoneRaw = dto.phone?.trim();
    if (phoneRaw) {
      const phoneNorm = normalizeVnPhone(phoneRaw);
      if (!phoneNorm) {
        throw new BadRequestException({ errors: { phone: 'Số điện thoại không hợp lệ' } });
      }
      const phoneTaken = await this.userRepo.findOne({ where: { phone: phoneNorm } });
      if (phoneTaken) {
        throw new ConflictException('Tài khoản đã tồn tại');
      }
    }
    if (dto.experienceYears != null && dto.experienceYears < 0) {
      throw new BadRequestException('Số năm kinh nghiệm không được âm');
    }
    const university = dto.university?.trim() || null;
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = this.userRepo.create({
      email: emailNorm,
      fullName: dto.fullName.trim(),
      phone: phoneRaw ? normalizeVnPhone(phoneRaw)! : null,
      passwordHash,
      role: 'doctor',
      departmentId: dto.departmentId || null,
      bio: dto.bio?.trim() || null,
      experienceYears: dto.experienceYears ?? null,
      university,
      avatarUrl: avatarUrl?.trim() || null,
    });
    const saved = await this.dataSource.transaction(async (em) => {
      const created = await em.save(UserEntity, user);
      await this.generateSlotsForDoctor(created.id, em);
      return created;
    });
    // Gửi email thông tin đăng nhập cho bác sĩ (nếu SMTP cấu hình). Không block việc tạo account nếu thiếu SMTP.
    try {
      if (this.mail.isConfigured()) {
        await this.mail.sendDoctorAccountCreatedEmail(saved.email, {
          doctorName: saved.fullName,
          email: saved.email,
          initialPassword: dto.password,
        });
      }
    } catch {
      // Log đã nằm trong MailService; tránh làm fail tạo bác sĩ do cấu hình SMTP.
    }
    return this.toPublic(saved);
  }

  async setDoctorLocked(doctorId: string, locked: boolean): Promise<{ message: string }> {
    const user = await this.userRepo.findOne({ where: { id: doctorId, role: 'doctor' } });
    if (!user) throw new NotFoundException('Không tìm thấy bác sĩ');
    await this.userRepo.update({ id: doctorId, role: 'doctor' }, {
      isLocked: Boolean(locked), tokenVersion: () => 'token_version + 1',
    });
    return { message: locked ? 'Đã khóa tài khoản bác sĩ.' : 'Đã mở khóa tài khoản bác sĩ.' };
  }

  async updateDoctor(
    doctorId: string,
    dto: {
      fullName?: string;
      email?: string;
      phone?: string | null;
      departmentId?: string | null;
      bio?: string | null;
      experienceYears?: number | null;
      university?: string | null;
    },
    avatarUrl?: string | null,
    repo: Repository<UserEntity> = this.userRepo,
  ): Promise<UserPublic> {
    const user = await repo.findOne({ where: { id: doctorId, role: 'doctor' } });
    if (!user) {
      throw new NotFoundException('Không tìm thấy bác sĩ');
    }

    if (dto.fullName !== undefined) {
      const n = dto.fullName.trim();
      if (!n) throw new BadRequestException('Họ tên không được để trống');
      user.fullName = n;
    }

    if (dto.email !== undefined) {
      const emailNorm = dto.email.trim().toLowerCase();
      if (!emailNorm) throw new BadRequestException('Email không hợp lệ');
      if (emailNorm !== user.email) {
        const taken = await repo.findOne({ where: { email: emailNorm } });
        if (taken) throw new ConflictException('Email đã được sử dụng');
        user.email = emailNorm;
      }
    }

    if (dto.phone !== undefined) {
      const raw = dto.phone?.trim() ?? '';
      if (!raw) {
        user.phone = null;
      } else {
        const phoneNorm = normalizeVnPhone(raw);
        if (!phoneNorm) {
          throw new BadRequestException({ errors: { phone: 'Số điện thoại không hợp lệ' } });
        }
        const phoneTaken = await repo.findOne({ where: { phone: phoneNorm } });
        if (phoneTaken && phoneTaken.id !== user.id) {
          throw new ConflictException('Tài khoản đã tồn tại');
        }
        user.phone = phoneNorm;
      }
    }

    if (dto.departmentId !== undefined) {
      user.departmentId = dto.departmentId?.trim() || null;
    }
    if (dto.bio !== undefined) {
      user.bio = dto.bio?.trim() || null;
    }
    if (dto.experienceYears !== undefined) {
      if (dto.experienceYears != null && dto.experienceYears < 0) {
        throw new BadRequestException('Số năm kinh nghiệm không được âm');
      }
      user.experienceYears = dto.experienceYears ?? null;
    }
    if (dto.university !== undefined) {
      user.university = dto.university?.trim() || null;
    }
    if (avatarUrl !== undefined && avatarUrl !== null) {
      user.avatarUrl = avatarUrl.trim() || null;
    }

    const saved = await repo.save(user);
    return this.toPublic(saved);
  }

  async setDoctorPassword(doctorId: string, password: string, confirmPassword: string): Promise<{ message: string }> {
    return this.setUserPasswordById(doctorId, 'doctor', password, confirmPassword);
  }

  /** Đổi mật khẩu tài khoản (bất kỳ vai trò). */
  async setUserPasswordById(
    userId: string,
    expectedRole: UserRole | null,
    password: string,
    confirmPassword: string,
  ): Promise<{ message: string }> {
    if (password !== confirmPassword) {
      throw new BadRequestException({ errors: { confirmPassword: 'Mật khẩu nhập lại không khớp' } });
    }
    const pwdErr = validateStrongPassword(password);
    if (pwdErr) {
      throw new BadRequestException({ errors: { password: pwdErr } });
    }
    const where: { id: string; role?: UserRole } = { id: userId };
    if (expectedRole) where.role = expectedRole;
    const user = await this.userRepo.findOne({ where });
    if (!user) {
      throw new NotFoundException('Không tìm thấy tài khoản');
    }
    await this.userRepo.update({ id: user.id }, {
      passwordHash: await bcrypt.hash(password, SALT_ROUNDS),
      tokenVersion: () => 'token_version + 1',
    });
    await this.dataSource.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);
    return { message: 'Đã cập nhật mật khẩu.' };
  }

  /** Tạo tài khoản bệnh nhân hoặc admin (bác sĩ dùng createDoctor). */
  async createManagedUser(
    dto: {
      email: string;
      password: string;
      fullName: string;
      phone?: string | null;
      role: 'user' | 'admin' | 'receptionist' | 'cashier';
    },
  ): Promise<UserPublic> {
    const pwdErr = validateStrongPassword(dto.password);
    if (pwdErr) {
      throw new BadRequestException({ errors: { password: pwdErr } });
    }
    const emailNorm = dto.email.trim().toLowerCase();
    const existing = await this.userRepo.findOne({ where: { email: emailNorm } });
    if (existing) {
      throw new ConflictException('Email đã được sử dụng');
    }
    let phoneNorm: string | null = null;
    const phoneRaw = dto.phone?.trim();
    if (phoneRaw) {
      phoneNorm = normalizeVnPhone(phoneRaw);
      if (!phoneNorm) {
        throw new BadRequestException({ errors: { phone: 'Số điện thoại không hợp lệ' } });
      }
      const phoneTaken = await this.userRepo.findOne({ where: { phone: phoneNorm } });
      if (phoneTaken) {
        throw new ConflictException('Số điện thoại đã được tài khoản khác sử dụng');
      }
    }
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = this.userRepo.create({
      email: emailNorm,
      fullName: dto.fullName.trim(),
      phone: phoneNorm,
      passwordHash,
      role: dto.role,
      departmentId: null,
      bio: null,
      experienceYears: null,
      university: null,
      avatarUrl: null,
    });
    const saved = await this.userRepo.save(user);
    return this.toPublic(saved);
  }

  /**
   * Cập nhật người dùng từ trang quản trị.
   * - Bác sĩ: cùng quy tắc với updateDoctor; không đổi `role` tại đây.
   * - Bệnh nhân / admin: fullName, email, phone, role (chỉ user ↔ admin).
   */
  async adminUpdateUser(
    actorId: string,
    targetId: string,
    body: {
      fullName?: string;
      email?: string;
      phone?: string | null;
      role?: 'user' | 'admin' | 'receptionist' | 'cashier';
      departmentId?: string | null;
      bio?: string | null;
      experienceYears?: number | null;
      university?: string | null;
    },
  ): Promise<UserPublic> {
    return this.dataSource.transaction(async (em) => {
      await em.query("SELECT pg_advisory_xact_lock(hashtext('smart-hospital:admin-access'))");
      const repo = em.getRepository(UserEntity);
      const user = await repo.findOne({ where: { id: targetId }, lock: { mode: 'pessimistic_write' } });
      if (!user) {
        throw new NotFoundException('Không tìm thấy người dùng');
      }

      if (user.role === 'doctor') {
        if (body.role !== undefined) {
          throw new BadRequestException('Không đổi vai trò bác sĩ qua API này.');
        }
        return this.updateDoctor(targetId, {
          fullName: body.fullName,
          email: body.email,
          phone: body.phone,
          departmentId: body.departmentId,
          bio: body.bio,
          experienceYears: body.experienceYears,
          university: body.university,
        }, undefined, repo);
      }

      if (body.role !== undefined) {
        if (!['user', 'admin', 'receptionist', 'cashier'].includes(body.role)) {
          throw new BadRequestException('Vai trò không hợp lệ');
        }
        if (user.role === 'admin' && !user.isLocked && body.role !== 'admin') {
          const adminCount = await repo.count({ where: { role: 'admin', isLocked: false } });
          if (adminCount <= 1) {
            throw new BadRequestException('Phải có ít nhất một tài khoản admin.');
          }
        }
        user.role = body.role;
      }

      if (body.fullName !== undefined) {
        const n = body.fullName.trim();
        if (!n) throw new BadRequestException('Họ tên không được để trống');
        user.fullName = n;
      }
      if (body.email !== undefined) {
        const emailNorm = body.email.trim().toLowerCase();
        if (!emailNorm) throw new BadRequestException('Email không hợp lệ');
        if (emailNorm !== user.email) {
          const taken = await repo.findOne({ where: { email: emailNorm } });
          if (taken) throw new ConflictException('Email đã được sử dụng');
          user.email = emailNorm;
        }
      }
      if (body.phone !== undefined) {
        const raw = body.phone === null || body.phone === undefined ? '' : String(body.phone).trim();
        if (!raw) {
          user.phone = null;
        } else {
          const p = normalizeVnPhone(raw);
          if (!p) {
            throw new BadRequestException({ errors: { phone: 'Số điện thoại không hợp lệ' } });
          }
          const phoneTaken = await repo.findOne({ where: { phone: p } });
          if (phoneTaken && phoneTaken.id !== user.id) {
            throw new ConflictException('Số điện thoại đã được tài khoản khác sử dụng');
          }
          user.phone = p;
        }
      }

      const saved = await repo.save(user);
      if (body.role !== undefined) await repo.increment({ id: user.id }, 'tokenVersion', 1);
      return this.toPublic(saved);
    });
  }

  /** Preserve medical/financial history: DELETE now deactivates the account. */
  async deleteManagedUser(actorId: string, targetId: string): Promise<{ message: string }> {
    return this.setManagedUserLocked(actorId, targetId, true);
  }

  async setManagedUserLocked(actorId: string, targetId: string, locked: boolean): Promise<{ message: string }> {
    if (actorId === targetId && locked) throw new ForbiddenException('Không thể vô hiệu hóa chính tài khoản đang đăng nhập.');
    return this.dataSource.transaction(async (em) => {
      // Shared lock serializes disabling admins, preserving one active admin.
      await em.query("SELECT pg_advisory_xact_lock(hashtext('smart-hospital:admin-access'))");
      const user = await em.findOne(UserEntity, { where: { id: targetId }, lock: { mode: 'pessimistic_write' } });
      if (!user) throw new NotFoundException('Không tìm thấy người dùng');
      if (locked && user.role === 'admin' && !user.isLocked) {
        const adminCount = await em.count(UserEntity, { where: { role: 'admin', isLocked: false } });
        if (adminCount <= 1) throw new BadRequestException('Không thể vô hiệu hóa admin hoạt động cuối cùng.');
      }
      await em.update(UserEntity, { id: targetId }, { isLocked: locked, tokenVersion: () => 'token_version + 1' });
      return { message: locked ? 'Đã vô hiệu hóa tài khoản; hồ sơ và giao dịch được giữ nguyên.' : 'Đã kích hoạt lại tài khoản. Vui lòng đăng nhập lại.' };
    });
  }

  /**
   * Tạo slot đặt lịch cho bác sĩ: T2–T6, 08:00–17:00 (trừ nghỉ trưa 11:30–13:00), mỗi slot 15 phút.
   * Chạy khi admin thêm bác sĩ.
   */
  private async generateSlotsForDoctor(doctorId: string, manager?: EntityManager): Promise<void> {
    await this.schedules.initializeDoctor(doctorId, manager);
  }

  async getDoctorById(doctorId: string): Promise<UserPublic> {
    const user = await this.userRepo.findOne({ where: { id: doctorId, role: 'doctor' } });
    if (!user) {
      throw new NotFoundException('Không tìm thấy bác sĩ');
    }
    return this.toPublic(user);
  }

  /** Đọc toàn bộ system_config. */
  async getSystemConfig(): Promise<{ key: string; value: string }[]> {
    try {
      return (await this.dataSource.query(
        `SELECT key, value FROM system_config ORDER BY key`,
      )) as { key: string; value: string }[];
    } catch {
      return [];
    }
  }

  /** Upsert 1 cặp key/value vào system_config. */
  async setSystemConfig(key: string, value: string, updatedBy: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO system_config (key, value, updated_by, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()`,
      [key, value, updatedBy],
    );
  }

  async findAllUsers(role?: UserRole): Promise<UserPublic[]> {
    const qb = this.userRepo
      .createQueryBuilder('u')
      .select([
        'u.id',
        'u.email',
        'u.fullName',
        'u.phone',
        'u.role',
        'u.isLocked',
        'u.departmentId',
        'u.bio',
        'u.experienceYears',
        'u.university',
        'u.avatarUrl',
        'u.createdAt',
      ]);
    if (role) {
      qb.andWhere('u.role = :role', { role });
    }
    qb.orderBy('u.fullName', 'ASC');
    const users = await qb.getMany();
    return users.map((u) => this.toPublic(u));
  }

  /**
   * Danh sách giao dịch thanh toán toàn hệ thống (theo thời điểm tạo giao dịch, giờ VN).
   */
  async listPaymentsForAdmin(
    fromIso?: string,
    toIso?: string,
    status?: PaymentStatus | null,
  ): Promise<AdminPaymentRowDto[]> {
    const { from, to } = this.resolveAdminDateRange(fromIso, toIso);
    const rows = (await this.dataSource.query(
      `SELECT
         p.id,
         p.amount,
         p.payment_type AS "paymentType",
         p.payment_method AS "paymentMethod",
         p.status,
         p.created_at AS "createdAt",
         p.payos_order_code AS "payosOrderCode",
         a.id AS "appointmentId",
         a.status AS "appointmentStatus",
         pat.id AS "patientId",
         pat.full_name AS "patientFullName",
         pat.email AS "patientEmail",
         doc.id AS "doctorId",
         doc.full_name AS "doctorFullName",
         s.slot_time AS "slotTime"
       FROM payments p
       INNER JOIN appointments a ON a.id = p.appointment_id
       INNER JOIN users pat ON pat.id = a.user_id
       INNER JOIN users doc ON doc.id = a.doctor_id
       LEFT JOIN appointment_slots s ON s.id = a.slot_id
       WHERE p.created_at >= ($1::date AT TIME ZONE $3)
         AND p.created_at < (($2::date + INTERVAL '1 day') AT TIME ZONE $3)
         AND ($4::text IS NULL OR p.status::text = $4::text)
       ORDER BY p.created_at DESC`,
      [from, to, STATS_TZ, status ?? null],
    )) as {
      id: string;
      amount: string | number;
      paymentType: string | null;
      paymentMethod: string | null;
      status: PaymentStatus;
      createdAt: Date;
      payosOrderCode: string | number | null;
      appointmentId: string;
      appointmentStatus: string;
      patientId: string;
      patientFullName: string;
      patientEmail: string;
      doctorId: string;
      doctorFullName: string;
      slotTime: Date | null;
    }[];

    return rows.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      paymentType: r.paymentType,
      paymentMethod: r.paymentMethod,
      status: r.status,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      payosOrderCode:
        r.payosOrderCode === null || r.payosOrderCode === undefined
          ? null
          : typeof r.payosOrderCode === 'bigint'
            ? Number(r.payosOrderCode)
            : Number(r.payosOrderCode),
      appointmentId: r.appointmentId,
      appointmentStatus: r.appointmentStatus,
      patient: {
        id: r.patientId,
        fullName: r.patientFullName,
        email: r.patientEmail,
      },
      doctor: { id: r.doctorId, fullName: r.doctorFullName },
      slotTime:
        r.slotTime instanceof Date
          ? r.slotTime.toISOString()
          : r.slotTime
            ? new Date(r.slotTime).toISOString()
            : null,
    }));
  }

  /** Báo cáo doanh thu & bệnh nhân trong khoảng ngày [from, to] (giờ VN). */
  async getAdminStatsOverview(fromIso?: string, toIso?: string): Promise<AdminStatsOverviewDto> {
    const { from, to } = this.resolveAdminDateRange(fromIso, toIso);
    const p = [from, to, STATS_TZ];

    const revenueRow = (await this.dataSource.query(
      `SELECT COALESCE(SUM(p.amount), 0)::numeric AS sum
       FROM payments p
       WHERE p.status::text = 'paid'
         AND p.created_at >= ($1::date AT TIME ZONE $3)
         AND p.created_at < (($2::date + INTERVAL '1 day') AT TIME ZONE $3)`,
      p,
    )) as { sum: string }[];

    const countRows = (await this.dataSource.query(
      `SELECT p.status::text AS status, COUNT(*)::int AS cnt
       FROM payments p
       WHERE p.created_at >= ($1::date AT TIME ZONE $3)
         AND p.created_at < (($2::date + INTERVAL '1 day') AT TIME ZONE $3)
       GROUP BY p.status`,
      p,
    )) as { status: string; cnt: number | string }[];

    const aptRow = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt
       FROM appointments a
       WHERE a.created_at >= ($1::date AT TIME ZONE $3)
         AND a.created_at < (($2::date + INTERVAL '1 day') AT TIME ZONE $3)`,
      p,
    )) as { cnt: number | string }[];

    const distinctPatientsRow = (await this.dataSource.query(
      `SELECT COUNT(DISTINCT a.user_id)::int AS cnt
       FROM appointments a
       WHERE a.created_at >= ($1::date AT TIME ZONE $3)
         AND a.created_at < (($2::date + INTERVAL '1 day') AT TIME ZONE $3)`,
      p,
    )) as { cnt: number | string }[];

    const patientAccountsRow = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt FROM users WHERE role = 'user'`,
    )) as { cnt: number | string }[];

    const newPatientsRow = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt
       FROM users u
       WHERE u.role = 'user'
         AND u.created_at >= ($1::date AT TIME ZONE $3)
         AND u.created_at < (($2::date + INTERVAL '1 day') AT TIME ZONE $3)`,
      p,
    )) as { cnt: number | string }[];

    const byDayRows = (await this.dataSource.query(
      `WITH series AS (
         SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS d
       ),
       agg AS (
         SELECT (p.created_at AT TIME ZONE $3)::date AS d, SUM(p.amount)::numeric AS total
         FROM payments p
         WHERE p.status::text = 'paid'
           AND p.created_at >= ($1::date AT TIME ZONE $3)
           AND p.created_at < (($2::date + INTERVAL '1 day') AT TIME ZONE $3)
         GROUP BY (p.created_at AT TIME ZONE $3)::date
       )
       SELECT to_char(s.d, 'YYYY-MM-DD') AS day,
              COALESCE(a.total, 0)::numeric AS total
       FROM series s
       LEFT JOIN agg a ON a.d = s.d
       ORDER BY s.d ASC`,
      p,
    )) as { day: string; total: string | number }[];

    const paymentCounts = { pending: 0, paid: 0, failed: 0 };
    for (const row of countRows) {
      const c = Number(row.cnt);
      if (row.status === PaymentStatus.Pending || row.status === 'pending') paymentCounts.pending = c;
      else if (row.status === PaymentStatus.Paid || row.status === 'paid') paymentCounts.paid = c;
      else if (row.status === PaymentStatus.Failed || row.status === 'failed') paymentCounts.failed = c;
    }

    const revenueByDay = byDayRows.map((r) => ({
      date: r.day,
      total: Number(r.total),
    }));

    return {
      range: { from, to },
      totalRevenuePaid: Number(revenueRow[0]?.sum ?? 0),
      paymentCounts,
      appointmentsInRange: Number(aptRow[0]?.cnt ?? 0),
      distinctPatientsWithAppointmentInRange: Number(distinctPatientsRow[0]?.cnt ?? 0),
      patientAccountsTotal: Number(patientAccountsRow[0]?.cnt ?? 0),
      newPatientRegistrationsInRange: Number(newPatientsRow[0]?.cnt ?? 0),
      revenueByDay,
    };
  }

  private resolveAdminDateRange(fromIso?: string, toIso?: string): { from: string; to: string } {
    const reIso = /^\d{4}-\d{2}-\d{2}$/;
    const todayDate = new Date();
    const todayStr = isoDateOnlyVN(todayDate);
    const defaultFrom = isoDateOnlyVN(new Date(todayDate.getTime() - 29 * 86_400_000));
    const from = fromIso && reIso.test(fromIso) ? fromIso : defaultFrom;
    const to = toIso && reIso.test(toIso) ? toIso : todayStr;
    if (from > to) {
      throw new BadRequestException('from phải <= to');
    }
    return { from, to };
  }

  private toPublic(u: UserEntity): UserPublic {
    return {
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      phone: u.phone,
      role: u.role,
      avatarUrl: u.avatarUrl ?? null,
      isLocked: u.isLocked,
      departmentId: u.departmentId,
      bio: u.bio,
      experienceYears: u.experienceYears,
      university: u.university,
      createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : undefined,
    };
  }
}

function isoDateOnlyVN(d: Date): string {
  const vn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return vn.toISOString().slice(0, 10);
}
