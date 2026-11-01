import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../models/user.model';
import { AppointmentSlotEntity } from '../models/appointment-slot.model';
import { AppointmentEntity } from '../models/appointment.model';
import { MedicalRecordEntity } from '../models/medical-record.model';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminAiUsageService } from './admin-ai-usage.service';
import { AuthModule } from '../auth/auth.module';
import { SchedulesModule } from '../schedules/schedules.module';
@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      AppointmentSlotEntity,
      AppointmentEntity,
      MedicalRecordEntity,
    ]),
    AuthModule,
    SchedulesModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminAiUsageService],
})
export class AdminModule {}
