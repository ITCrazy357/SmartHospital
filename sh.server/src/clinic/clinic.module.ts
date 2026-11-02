import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClinicController } from './clinic.controller';
import { ClinicService } from './clinic.service';

@Module({ imports: [AuthModule], controllers: [ClinicController], providers: [ClinicService] })
export class ClinicModule {}
