import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Query,
  BadRequestException,
} from '@nestjs/common';
import {
  AppointmentsService,
  CreateBookingResult,
  AppointmentWithDetailsDto,
  PaymentHistoryItemDto,
} from './appointments.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserPublic } from '../models/user.model';
import { ConfigService } from '@nestjs/config';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { isUuid } from '../common/is-uuid';

@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('user')
  async create(
    @CurrentUser() user: UserPublic,
    @Body() dto: CreateBookingDto,
  ): Promise<CreateBookingResult> {
    if (!isUuid(dto.slotId))
      throw new BadRequestException('slotId phải là UUID');
    const baseUrl =
      this.config.get<string>('CLIENT_APP_URL') ?? 'http://localhost:5431';
    const returnUrl = dto.returnUrl ?? `${baseUrl}/booking/success`;
    const cancelUrl = dto.cancelUrl ?? `${baseUrl}/booking/cancel`;
    return this.appointmentsService.createBooking(
      user.id,
      dto,
      returnUrl,
      cancelUrl,
    );
  }

  @Get(':id/status')
  @UseGuards(JwtAuthGuard)
  status(
    @CurrentUser() user: UserPublic,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.appointmentsService.statusForPatient(user.id, id);
  }

  @Post(':id/reschedule')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('user')
  reschedule(
    @CurrentUser() user: UserPublic,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { slotId: string; reason: string },
  ) {
    if (!isUuid(body.slotId) || typeof body.reason !== 'string')
      throw new BadRequestException('Ca mới/lý do không hợp lệ');
    return this.appointmentsService.reschedule(
      user.id,
      id,
      body.slotId,
      body.reason,
    );
  }

  @Post(':id/checkout')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('user')
  resumeCheckout(
    @CurrentUser() user: UserPublic,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.appointmentsService.resumeCheckout(user.id, id);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMyAppointments(
    @CurrentUser() user: UserPublic,
    @Query('page') page?: string,
  ): Promise<AppointmentWithDetailsDto[]> {
    const p = Number(page ?? 1);
    if (!Number.isInteger(p) || p < 1 || p > 100000)
      throw new BadRequestException('Trang không hợp lệ');
    return this.appointmentsService.findMyAppointments(user.id, p);
  }

  @Get('me/payments')
  @UseGuards(JwtAuthGuard)
  async getMyPayments(
    @CurrentUser() user: UserPublic,
    @Query('page') page?: string,
  ): Promise<PaymentHistoryItemDto[]> {
    const p = Number(page ?? 1);
    if (!Number.isInteger(p) || p < 1 || p > 100000)
      throw new BadRequestException('Trang không hợp lệ');
    return this.appointmentsService.findMyPayments(user.id, p);
  }

  /** Bệnh nhân tự huỷ cuộc hẹn của chính mình. Mất cọc nếu đã thanh toán. */
  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  async cancelMine(
    @CurrentUser() user: UserPublic,
    @Param('id', ParseUUIDPipe) appointmentId: string,
    @Body() body: { reason?: string | null } = {},
  ) {
    return this.appointmentsService.cancelByPatient(
      user.id,
      appointmentId,
      body?.reason,
    );
  }
}
