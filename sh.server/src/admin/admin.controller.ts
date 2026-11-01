import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Query,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Body,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminService } from './admin.service';
import { AdminAiUsageService } from './admin-ai-usage.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { UserPublic } from '../models/user.model';
import { PaymentStatus } from '../models/enums';
import type { AdminPaymentRowDto } from './admin.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { avatarMulterOptions } from '../common/avatar-upload.config';
import { S3UploadService } from '../common/s3-upload.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly aiUsage: AdminAiUsageService,
    private readonly s3: S3UploadService,
  ) {}

  /** Báo cáo chi phí AI (OpenAI) — tổng + breakdown theo feature, model, ngày. */
  @Get('ai-usage/stats')
  async aiUsageStats(@Query('from') from?: string, @Query('to') to?: string) {
    return this.aiUsage.getStats(from, to);
  }

  @Get('users')
  async getUsers(@Query('role') role?: 'user' | 'doctor' | 'admin' | 'receptionist' | 'cashier'): Promise<UserPublic[]> {
    return this.adminService.findAllUsers(role);
  }

  /** Danh sách giao dịch thanh toán (lọc theo ngày tạo giao dịch, giờ VN). */
  @Get('payments')
  async listPayments(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
  ): Promise<AdminPaymentRowDto[]> {
    let st: PaymentStatus | undefined;
    if (status !== undefined && status !== '') {
      const allowed = Object.values(PaymentStatus);
      if (!allowed.includes(status as PaymentStatus)) {
        throw new BadRequestException('status phải là pending, paid hoặc failed');
      }
      st = status as PaymentStatus;
    }
    return this.adminService.listPaymentsForAdmin(from, to, st);
  }

  /** Báo cáo doanh thu & thống kê bệnh nhân/lịch hẹn trong khoảng ngày. */
  @Get('stats/overview')
  async statsOverview(@Query('from') from?: string, @Query('to') to?: string) {
    return this.adminService.getAdminStatsOverview(from, to);
  }

  /** Tạo tài khoản bệnh nhân hoặc admin (bác sĩ: POST /admin/doctors). */
  @Post('users')
  async createUser(
    @Body()
    body: {
      email?: string;
      password?: string;
      fullName?: string;
      phone?: string | null;
      role?: 'user' | 'admin' | 'receptionist' | 'cashier';
    },
  ): Promise<UserPublic> {
    const email = body.email?.trim();
    const password = body.password ?? '';
    const fullName = body.fullName?.trim();
    const role = body.role ?? 'user';
    if (!email || !password || !fullName) {
      throw new BadRequestException('Thiếu email, mật khẩu hoặc họ tên');
    }
    if (!['user', 'admin', 'receptionist', 'cashier'].includes(role)) {
      throw new BadRequestException('role phải là user, admin, receptionist hoặc cashier');
    }
    return this.adminService.createManagedUser({
      email,
      password,
      fullName,
      phone: body.phone,
      role,
    });
  }

  @Patch('users/:id')
  async patchUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
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
    @CurrentUser() actor: UserPublic,
  ): Promise<UserPublic> {
    const dto: Parameters<AdminService['adminUpdateUser']>[2] = {};
    if (body.fullName !== undefined) dto.fullName = body.fullName;
    if (body.email !== undefined) dto.email = body.email;
    if (body.phone !== undefined) dto.phone = body.phone;
    if (body.role !== undefined) dto.role = body.role;
    if (body.departmentId !== undefined) {
      dto.departmentId = String(body.departmentId).trim() === '' ? null : String(body.departmentId).trim();
    }
    if (body.bio !== undefined) dto.bio = body.bio;
    if (body.university !== undefined) dto.university = body.university;
    if (body.experienceYears !== undefined && String(body.experienceYears).trim() !== '') {
      const n = parseInt(String(body.experienceYears), 10);
      if (Number.isNaN(n) || n < 0) {
        throw new BadRequestException('Số năm kinh nghiệm phải là số không âm');
      }
      dto.experienceYears = n;
    } else if (body.experienceYears !== undefined) {
      dto.experienceYears = null;
    }
    return this.adminService.adminUpdateUser(actor.id, id, dto);
  }

  @Delete('users/:id')
  async deleteUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: UserPublic,
  ): Promise<{ message: string }> {
    return this.adminService.deleteManagedUser(actor.id, id);
  }

  @Patch('users/:id/lock')
  async setManagedUserLock(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: UserPublic,
    @Body() body: { locked?: boolean },
  ): Promise<{ message: string }> {
    if (typeof body?.locked !== 'boolean') throw new BadRequestException('locked phải là boolean');
    return this.adminService.setManagedUserLocked(actor.id, id, body.locked);
  }

  @Patch('users/:id/password')
  async setUserPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { password?: string; confirmPassword?: string },
  ): Promise<{ message: string }> {
    return this.adminService.setUserPasswordById(id, null, body.password ?? '', body.confirmPassword ?? '');
  }

  @Get('doctors/:id')
  async getDoctor(@Param('id') id: string): Promise<{ user: UserPublic }> {
    const user = await this.adminService.getDoctorById(id);
    return { user };
  }

  @Post('doctors')
  @UseInterceptors(FileInterceptor('avatar', avatarMulterOptions))
  async createDoctor(
    @Body() body: Record<string, string>,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ user: UserPublic }> {
    const email = body.email?.trim();
    const password = body.password;
    const fullName = body.fullName?.trim();
    if (!email || !password || !fullName) {
      throw new BadRequestException('Thiếu email, mật khẩu hoặc họ tên');
    }
    let experienceYears: number | null = null;
    if (body.experienceYears != null && String(body.experienceYears).trim() !== '') {
      const n = parseInt(String(body.experienceYears), 10);
      if (Number.isNaN(n) || n < 0) {
        throw new BadRequestException('Số năm kinh nghiệm phải là số không âm');
      }
      experienceYears = n;
    }
    const university = body.university?.trim() || null;
    const dto: CreateDoctorDto = {
      email,
      password,
      fullName,
      phone: body.phone?.trim() || undefined,
      departmentId: body.departmentId?.trim() || null,
      bio: body.bio?.trim() || null,
      experienceYears,
      university,
    };
    const avatarUrl = file ? await this.s3.upload(file, 'avatars') : null;
    const user = await this.adminService.createDoctor(dto, avatarUrl);
    return { user };
  }

  @Patch('doctors/:id/password')
  async setDoctorPassword(
    @Param('id') id: string,
    @Body() body: { password?: string; confirmPassword?: string },
  ): Promise<{ message: string }> {
    return this.adminService.setDoctorPassword(id, body.password ?? '', body.confirmPassword ?? '');
  }

  /** Khóa / mở khóa đăng nhập tài khoản bác sĩ. */
  @Patch('doctors/:id/lock')
  async setDoctorLock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { locked?: boolean },
  ): Promise<{ message: string }> {
    return this.adminService.setDoctorLocked(id, Boolean(body.locked));
  }

  /** Lấy cấu hình hệ thống (deposit_amount). */
  @Get('config')
  async getConfig(): Promise<{ depositAmount: number }> {
    const rows = (await this.adminService.getSystemConfig()) as { key: string; value: string }[];
    const row = rows.find((r) => r.key === 'deposit_amount');
    return { depositAmount: row ? Number(row.value) : 50_000 };
  }

  /** Cập nhật tiền cọc đặt lịch (VND, tối thiểu 1.000). */
  @Patch('config/deposit-amount')
  async setDepositAmount(
    @Body() body: { amount?: number },
    @CurrentUser() actor: UserPublic,
  ): Promise<{ depositAmount: number; message: string }> {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 1_000) {
      throw new BadRequestException('Tiền cọc phải là số nguyên dương tối thiểu 1.000 VND');
    }
    await this.adminService.setSystemConfig('deposit_amount', String(Math.round(amount)), actor.id);
    return { depositAmount: Math.round(amount), message: 'Đã cập nhật tiền cọc.' };
  }

  @Patch('doctors/:id')
  @UseInterceptors(FileInterceptor('avatar', avatarMulterOptions))
  async updateDoctor(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ user: UserPublic }> {
    const dto: {
      fullName?: string;
      email?: string;
      phone?: string | null;
      departmentId?: string | null;
      bio?: string | null;
      experienceYears?: number | null;
      university?: string | null;
    } = {};

    if (body.fullName !== undefined) dto.fullName = body.fullName;
    if (body.email !== undefined) dto.email = body.email;
    if (body.phone !== undefined) {
      dto.phone = String(body.phone).trim() === '' ? null : body.phone;
    }
    if (body.departmentId !== undefined) {
      dto.departmentId = String(body.departmentId).trim() === '' ? null : body.departmentId.trim();
    }
    if (body.bio !== undefined) dto.bio = body.bio;
    if (body.university !== undefined) dto.university = body.university;
    if (body.experienceYears !== undefined && String(body.experienceYears).trim() !== '') {
      const n = parseInt(String(body.experienceYears), 10);
      if (Number.isNaN(n) || n < 0) {
        throw new BadRequestException('Số năm kinh nghiệm phải là số không âm');
      }
      dto.experienceYears = n;
    } else if (body.experienceYears !== undefined) {
      dto.experienceYears = null;
    }

    const avatarPath = file ? await this.s3.upload(file, 'avatars') : undefined;
    const user = await this.adminService.updateDoctor(id, dto, avatarPath);
    return { user };
  }
}
