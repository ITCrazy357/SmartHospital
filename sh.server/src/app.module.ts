import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DepartmentsModule } from './departments/departments.module';
import { DoctorsModule } from './doctors/doctors.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { LeaveRequestsModule } from './leave-requests/leave-requests.module';
import { MedicalRecordsModule } from './medical-records/medical-records.module';
import { AdsModule } from './ads/ads.module';
import { AiModule } from './ai/ai.module';
import { AiSuggestModule } from './ai-suggest/ai-suggest.module';
import { DoctorAiModule } from './doctor-ai/doctor-ai.module';
import { ClinicModule } from './clinic/clinic.module';
import { SchedulesModule } from './schedules/schedules.module';
import { HealthController } from './health.controller';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      // Luôn đọc .env cạnh thư mục build (dist/), không phụ thuộc cwd — tránh “SMTP chưa cấu hình” khi chạy từ repo gốc
      envFilePath: join(__dirname, '..', '.env'),
    }),
    RedisModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        const useSsl = process.env.POSTGRES_SSL === 'true';

        return {
          type: 'postgres' as const,
          ...(process.env.DATABASE_URL
            ? { url: process.env.DATABASE_URL }
            : {
                host: process.env.POSTGRES_HOST ?? 'localhost',
                port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
                username: process.env.POSTGRES_USER ?? 'sh_user',
                password: process.env.POSTGRES_PASSWORD ?? 'sh_password',
                database: process.env.POSTGRES_DB ?? 'smart_hospital',
              }),

          ssl: useSsl
            ? {
                rejectUnauthorized: true,
              }
            : false,

          autoLoadEntities: true,
          synchronize: false,
        };
      },
    }),
    DepartmentsModule,
    DoctorsModule,
    AuthModule,
    AdminModule,
    AppointmentsModule,
    LeaveRequestsModule,
    MedicalRecordsModule,
    AdsModule,
    AiModule,
    AiSuggestModule,
    DoctorAiModule,
    SchedulesModule,
    ClinicModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
