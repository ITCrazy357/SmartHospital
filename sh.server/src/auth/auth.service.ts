import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { UserEntity, UserPublic } from '../models/user.model';
import { PasswordResetTokenEntity } from '../models/password-reset-token.model';
import {
  normalizeVnPhone,
  validatePatientRegisterInput,
  validateUpdateProfileInput,
  isValidEmailFormat,
  validateNewPasswordPair,
} from '../common/patient-account.validation';
import { MailService } from './mail.service';

const SALT_ROUNDS = 10;

export interface RegisterDto {
  email: string;
  password: string;
  /** Khớp với password (PB01) */
  confirmPassword: string;
  fullName: string;
  phone: string;
}

export interface RegisterSuccessDto {
  message: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface AuthResult {
  access_token: string;
  user: UserPublic;
}

export interface ResetPasswordDto {
  token: string;
  password: string;
  confirmPassword: string;
}

/** PATCH /auth/me — bệnh nhân tự cập nhật hồ sơ (chỉ fullName + phone). */
export interface UpdateMeDto {
  fullName: string;
  phone: string;
}

const FORGOT_PASSWORD_RESPONSE = {
  message:
    'Nếu email tồn tại trong hệ thống, bạn sẽ nhận hướng dẫn đặt lại mật khẩu trong ít phút. Vui lòng kiểm tra hộp thư.',
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(PasswordResetTokenEntity)
    private readonly resetTokenRepo: Repository<PasswordResetTokenEntity>,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

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

  async register(dto: RegisterDto): Promise<RegisterSuccessDto> {
    const fieldErrors = validatePatientRegisterInput({
      fullName: dto.fullName,
      email: dto.email,
      phone: dto.phone,
      password: dto.password,
      confirmPassword: dto.confirmPassword,
    });
    if (fieldErrors) {
      throw new BadRequestException({ errors: fieldErrors });
    }

    const emailNorm = dto.email.trim().toLowerCase();
    const phoneNorm = normalizeVnPhone(dto.phone)!;

    const existingEmail = await this.userRepo.findOne({ where: { email: emailNorm } });
    const existingPhone = await this.userRepo.findOne({ where: { phone: phoneNorm } });
    if (existingEmail || existingPhone) {
      throw new ConflictException('Tài khoản đã tồn tại');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = this.userRepo.create({
      email: emailNorm,
      fullName: dto.fullName.trim(),
      phone: phoneNorm,
      passwordHash,
      role: 'user',
    });
    await this.userRepo.save(user);
    return { message: 'Đăng ký thành công' };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    if (typeof dto?.email !== 'string' || typeof dto?.password !== 'string') {
      throw new BadRequestException('Email và mật khẩu phải là chuỗi.');
    }
    const user = await this.userRepo.createQueryBuilder('u')
      .addSelect(['u.passwordHash', 'u.tokenVersion'])
      .where('u.email = :email', { email: dto.email.trim().toLowerCase() })
      .getOne();
    if (!user) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }
    if (user.isLocked) {
      throw new ForbiddenException('Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ quản trị.');
    }
    const token = this.jwtService.sign({ sub: user.id, email: user.email, ver: user.tokenVersion });
    return {
      access_token: token,
      user: this.toUserPublic(user),
    };
  }

  async validateUserById(userId: string, tokenVersion?: number): Promise<UserPublic | null> {
    if (!Number.isInteger(tokenVersion) || tokenVersion! < 0) return null;
    const user = await this.userRepo.createQueryBuilder('u')
      .addSelect('u.tokenVersion')
      .where('u.id = :id', { id: userId })
      .getOne();
    if (!user || user.isLocked || user.tokenVersion !== tokenVersion) return null;
    return this.toUserPublic(user);
  }

  /** Logout revokes every token issued for the account, including tokens on other devices. */
  async logout(userId: string): Promise<{ message: string }> {
    await this.userRepo.increment({ id: userId }, 'tokenVersion', 1);
    return { message: 'Đã đăng xuất khỏi tất cả thiết bị.' };
  }

  async updateAvatar(userId: string, avatarPath: string): Promise<UserPublic> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    user.avatarUrl = avatarPath;
    const saved = await this.userRepo.save(user);
    return this.toUserPublic(saved);
  }

  /**
   * Bệnh nhân (và mọi user đã đăng nhập) tự cập nhật hồ sơ cá nhân.
   * Chỉ cho phép đổi fullName + phone. Email không sửa được vì là định danh đăng nhập.
   * Phone phải duy nhất (DB có unique index) — kiểm tra trùng trước khi save để trả lỗi tiếng Việt.
   */
  async updateMe(userId: string, dto: UpdateMeDto): Promise<UserPublic> {
    const fieldErrors = validateUpdateProfileInput({
      fullName: dto.fullName ?? '',
      phone: dto.phone ?? '',
    });
    if (fieldErrors) {
      throw new BadRequestException({ errors: fieldErrors });
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    const fullNameNorm = dto.fullName.trim();
    const phoneNorm = normalizeVnPhone(dto.phone)!;

    if (phoneNorm !== user.phone) {
      const existingPhone = await this.userRepo.findOne({ where: { phone: phoneNorm } });
      if (existingPhone && existingPhone.id !== user.id) {
        throw new ConflictException({
          errors: { phone: 'Số điện thoại đã được sử dụng' },
        });
      }
    }

    user.fullName = fullNameNorm;
    user.phone = phoneNorm;
    const saved = await this.userRepo.save(user);
    return this.toUserPublic(saved);
  }

  /** Change credentials atomically; concurrent resets cannot be overwritten by a stale password check. */
  async changeMyPassword(
    userId: string,
    currentPassword: string,
    password: string,
    confirmPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.userRepo.createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.id = :id', { id: userId })
      .andWhere('u.isLocked = false')
      .getOne();
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    const cur = currentPassword ?? '';
    if (!cur) {
      throw new BadRequestException({ errors: { currentPassword: 'Vui lòng nhập mật khẩu hiện tại' } });
    }
    const ok = await bcrypt.compare(cur, user.passwordHash);
    if (!ok) {
      throw new BadRequestException({ errors: { currentPassword: 'Mật khẩu hiện tại không đúng' } });
    }

    const fieldErrors = validateNewPasswordPair(password ?? '', confirmPassword ?? '');
    if (fieldErrors) {
      throw new BadRequestException({ errors: fieldErrors });
    }

    const updated = await this.userRepo.update(
      { id: userId, passwordHash: user.passwordHash, isLocked: false },
      { passwordHash: await bcrypt.hash(password, SALT_ROUNDS), tokenVersion: () => 'token_version + 1' },
    );
    if (updated.affected !== 1) {
      throw new ConflictException('Tài khoản vừa thay đổi. Vui lòng đăng nhập lại.');
    }
    await this.resetTokenRepo.delete({ userId });
    return { message: 'Đã cập nhật mật khẩu. Vui lòng đăng nhập lại.' };
  }

  private hashResetToken(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'utf8').digest('hex');
  }

  private clientAppBaseUrl(): string {
    const u = process.env.CLIENT_APP_URL?.trim();
    if (u) return u.replace(/\/$/, '');
    return 'http://localhost:5173';
  }

  /** Chỉ tài khoản bệnh nhân (role user). Luôn trả cùng message để không lộ email có tồn tại hay không. */
  async requestPasswordReset(emailRaw: string): Promise<{ message: string }> {
    const email = emailRaw?.trim().toLowerCase() ?? '';
    if (!email) {
      throw new BadRequestException({ errors: { email: 'Vui lòng nhập email' } });
    }
    if (!isValidEmailFormat(email)) {
      throw new BadRequestException({ errors: { email: 'Email không đúng định dạng' } });
    }

    const user = await this.userRepo.findOne({
      where: { email, role: 'user', isLocked: false },
    });
    if (!user) {
      return FORGOT_PASSWORD_RESPONSE;
    }

    await this.resetTokenRepo.delete({ userId: user.id });

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const row = this.resetTokenRepo.create({
      userId: user.id,
      tokenHash,
      expiresAt,
    });
    await this.resetTokenRepo.save(row);

    const resetLink = `${this.clientAppBaseUrl()}/?view=reset-password&token=${rawToken}`;

    try {
      if (this.mailService.isConfigured()) {
        await this.mailService.sendPasswordResetEmail(user.email, resetLink);
      } else {
        if (process.env.NODE_ENV !== 'production') {
          this.logger.warn(`[dev] SMTP chưa cấu hình — liên kết đặt lại mật khẩu: ${resetLink}`);
        } else {
          this.logger.warn('SMTP/MAIL_FROM chưa cấu hình — không gửi được email đặt lại mật khẩu.');
        }
      }
    } catch (e) {
      this.logger.warn(`Gửi email đặt lại mật khẩu thất bại: ${e instanceof Error ? e.message : e}`);
    }

    return FORGOT_PASSWORD_RESPONSE;
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const fieldErrors = validateNewPasswordPair(dto.password ?? '', dto.confirmPassword ?? '');
    if (fieldErrors) {
      throw new BadRequestException({ errors: fieldErrors });
    }

    const raw = dto.token?.trim() ?? '';
    if (!raw) {
      throw new BadRequestException({ errors: { token: 'Thiếu mã đặt lại mật khẩu' } });
    }

    const tokenHash = this.hashResetToken(raw);
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    await this.resetTokenRepo.manager.transaction(async (em) => {
      // DELETE ... RETURNING consumes a reset token once even when requests race.
      const consumed = await em.createQueryBuilder()
        .delete().from(PasswordResetTokenEntity)
        .where('token_hash = :tokenHash', { tokenHash })
        .andWhere('expires_at > CURRENT_TIMESTAMP')
        .returning('user_id').execute();
      const userId = (consumed.raw as { user_id: string }[])[0]?.user_id;
      if (!userId) {
        throw new BadRequestException('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
      }
      const updated = await em.update(UserEntity,
        { id: userId, role: 'user', isLocked: false },
        { passwordHash, tokenVersion: () => 'token_version + 1' },
      );
      if (updated.affected !== 1) {
        throw new BadRequestException('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
      }
      await em.delete(PasswordResetTokenEntity, { userId });
    });

    return { message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập.' };
  }
}
