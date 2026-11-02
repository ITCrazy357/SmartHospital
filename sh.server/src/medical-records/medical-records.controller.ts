import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserPublic } from '../models/user.model';
import { MedicalRecordsService } from './medical-records.service';
import { MedicalRecordEmbeddingsService } from './medical-record-embeddings.service';

/**
 * API hồ sơ khám: client gọi controller → service.
 * Route `me/*`: bác sĩ đang đăng nhập (JWT + role doctor).
 */
@Controller('medical-records')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('doctor')
export class MedicalRecordsController {
  constructor(
    private readonly medicalRecords: MedicalRecordsService,
    private readonly embeddings: MedicalRecordEmbeddingsService,
  ) {}

  /**
   * Backfill embeddings cho mọi record CHƯA có vector. Bác sĩ tự chạy được —
   * RAG chỉ tìm trong record của mình nên tự bảo vệ. Trả về số lượng đã xử lý.
   */
  @Post('me/backfill-embeddings')
  backfillEmbeddings(@CurrentUser() user: UserPublic, @Body() body: { forceAll?: boolean; limit?: number } | undefined) {
    return this.embeddings.backfill({
      doctorId: user.id,
      forceAll: body?.forceAll === true,
      limit: typeof body?.limit === 'number' ? body!.limit : undefined,
    });
  }

  /** Lịch đã qua giờ ca, đã cọc/xác nhận, chưa có medical_records */
  @Get('me/pending-appointments')
  listPending(@CurrentUser() user: UserPublic) {
    return this.medicalRecords.listPendingForDoctor(user.id);
  }

  /** Nhập hồ sơ sau khi ca khám kết thúc */
  @Post('me')
  createFromAppointment(
    @CurrentUser() user: UserPublic,
    @Body()
    body: {
      appointmentId: string;
      symptoms?: string | null;
      diagnosis?: string | null;
      treatment?: string | null;
      notes?: string | null;
    },
  ) {
    return this.medicalRecords.createFromAppointment(user.id, body);
  }

  /** Danh sách hồ sơ khám do bác sĩ này tạo */
  @Get('me/records')
  listMyRecords(@CurrentUser() user: UserPublic) {
    return this.medicalRecords.listMyRecords(user.id);
  }

  /** Chi tiết 1 hồ sơ — dùng khi click "Xem hồ sơ" từ kết quả AI. */
  @Get('me/records/:recordId')
  getMyRecord(
    @CurrentUser() user: UserPublic,
    @Param('recordId', ParseUUIDPipe) recordId: string,
  ) {
    return this.medicalRecords.getMyRecordById(user.id, recordId);
  }

  @Get('me/records/:recordId/revisions')
  revisions(@CurrentUser() user:UserPublic,@Param('recordId',ParseUUIDPipe) recordId:string){
    return this.medicalRecords.revisionsForDoctor(user.id,recordId);
  }

  /** Thống kê bệnh án của bác sĩ trong khoảng [from, to] (mặc định 30 ngày). */
  @Get('me/stats')
  statsForMe(
    @CurrentUser() user: UserPublic,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.medicalRecords.statsForDoctor(user.id, from, to);
  }

  /** Cập nhật nội dung hồ sơ (triệu chứng, chẩn đoán, …) */
  @Patch('me/records/:recordId')
  updateMyRecord(
    @CurrentUser() user: UserPublic,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Body()
    body: {
      version?: number;
      reason?: string;
      symptoms?: string | null;
      diagnosis?: string | null;
      treatment?: string | null;
      notes?: string | null;
    },
  ) {
    return this.medicalRecords.updateMyRecord(user.id, recordId, body);
  }
}
