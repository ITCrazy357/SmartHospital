import {
  Controller,
  Post,
  Body,
  Get,
  Patch,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthService } from './auth.service';
import type { RegisterDto, LoginDto, ResetPasswordDto, UpdateMeDto } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { UserPublic } from '../models/user.model';
import { avatarMulterOptions } from '../common/avatar-upload.config';
import { S3UploadService } from '../common/s3-upload.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly s3: S3UploadService,
  ) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() user: UserPublic) {
    return this.authService.logout(user.id);
  }

  @Post('forgot-password')
  async forgotPassword(@Body() body: { email?: string }) {
    return this.authService.requestPasswordReset(body.email ?? '');
  }

  @Post('reset-password')
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: UserPublic) {
    return { user };
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateMe(
    @CurrentUser() user: UserPublic,
    @Body() dto: UpdateMeDto,
  ): Promise<{ user: UserPublic }> {
    const updated = await this.authService.updateMe(user.id, dto);
    return { user: updated };
  }

  @Patch('me/avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('avatar', avatarMulterOptions))
  async updateMyAvatar(
    @CurrentUser() user: UserPublic,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ user: UserPublic }> {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn file ảnh');
    }
    const avatarUrl = await this.s3.upload(file, 'avatars');
    const updated = await this.authService.updateAvatar(user.id, avatarUrl);
    return { user: updated };
  }

  /** Đổi mật khẩu của chính mình (user). */
  @Patch('me/password')
  @UseGuards(JwtAuthGuard)
  async changeMyPassword(
    @CurrentUser() user: UserPublic,
    @Body() body: { currentPassword?: string; password?: string; confirmPassword?: string },
  ): Promise<{ message: string }> {
    return this.authService.changeMyPassword(
      user.id,
      body.currentPassword ?? '',
      body.password ?? '',
      body.confirmPassword ?? '',
    );
  }
}
