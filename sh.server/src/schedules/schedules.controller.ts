import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserPublic } from '../models/user.model';
import { SchedulesService } from './schedules.service';

@Controller('admin/schedules')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}
  @Get(':doctorId')
  plan(@Param('doctorId', ParseUUIDPipe) doctorId: string) {
    return this.schedules.plan(doctorId);
  }
  @Post(':doctorId/preview')
  preview(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.schedules.preview(doctorId, body.rules);
  }
  @Put(':doctorId')
  save(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @CurrentUser() actor: UserPublic,
    @Body() body: Record<string, unknown>,
  ) {
    return this.schedules.saveRules(doctorId, actor.id, body);
  }
  @Post(':doctorId/exceptions')
  exception(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @CurrentUser() actor: UserPublic,
    @Body() body: Record<string, unknown>,
  ) {
    return this.schedules.setException(doctorId, actor.id, body);
  }
  @Post(':doctorId/exceptions/preview')
  previewException(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.schedules.previewException(doctorId, body);
  }
  @Post(':doctorId/generate')
  generate(@Param('doctorId', ParseUUIDPipe) doctorId: string) {
    return this.schedules.generateForDoctor(doctorId);
  }
}
