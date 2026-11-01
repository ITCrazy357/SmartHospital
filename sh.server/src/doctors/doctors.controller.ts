import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DoctorsService } from './doctors.service';
import { isUuid } from '../common/is-uuid';
import type { PublicDoctorDto } from './public-doctor.dto';
import type { DoctorScheduleEntity } from '../models/doctor-schedule.model';
import type { AppointmentSlotEntity } from '../models/appointment-slot.model';

@Controller('doctors')
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  @Get()
  async findAll(
    @Query('departmentId') departmentId?: string,
  ): Promise<PublicDoctorDto[]> {
    const raw = departmentId?.trim();
    if (raw && !isUuid(raw)) {
      throw new BadRequestException('departmentId phải là UUID hợp lệ');
    }
    return this.doctorsService.findAll(raw || undefined);
  }

  @Get(':id/schedules')
  async getSchedules(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('workDay') workDay?: string,
  ): Promise<DoctorScheduleEntity[]> {
    return this.doctorsService.findSchedulesByDoctor(id, workDay);
  }

  /** Slot còn trống của bác sĩ cho đặt lịch. */
  @Get(':id/slots')
  async getSlots(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') fromDate?: string,
  ): Promise<AppointmentSlotEntity[]> {
    return this.doctorsService.findSlotsByDoctor(id, fromDate, true);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PublicDoctorDto> {
    const one = await this.doctorsService.findOne(id);
    if (!one) throw new NotFoundException('Doctor not found');
    return one;
  }
}
