import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserPublic } from '../models/user.model';
import { SpecialtySuggestService } from './specialty-suggest.service';
import { SlotSuggestService } from './slot-suggest.service';

/**
 * Endpoints public-facing cho các tính năng AI gợi ý dành cho bệnh nhân.
 *  - /suggest-departments: đăng nhập + đồng ý xử lý dữ liệu AI.
 *  - /suggest-slots: cần đăng nhập (role=user) vì cần history pattern cá nhân.
 */
@Controller('ai')
export class AiSuggestController {
  constructor(
    private readonly specialty: SpecialtySuggestService,
    private readonly slot: SlotSuggestService,
  ) {}

  @Post('suggest-departments')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('user')
  async suggestDepartments(@CurrentUser() user: UserPublic, @Body() body: { symptoms?: string } = {}) {
    return this.specialty.suggest(body?.symptoms ?? '', user.id);
  }

  @Post('suggest-slots')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('user')
  async suggestSlots(
    @CurrentUser() user: UserPublic,
    @Body() body: { doctorId?: string; symptoms?: string | null; daysAhead?: number } = {},
  ) {
    if (!body.doctorId) throw new BadRequestException('Thiếu doctorId');
    const days =
      typeof body.daysAhead === 'number' && body.daysAhead > 0 ? body.daysAhead : undefined;
    return this.slot.suggest({
      userId: user.id,
      doctorId: body.doctorId,
      symptoms: body.symptoms ?? null,
      daysAhead: days,
    });
  }
}
