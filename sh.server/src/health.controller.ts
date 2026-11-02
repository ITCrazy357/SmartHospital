import { Controller, Get, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { readdirSync } from 'fs';
import { join } from 'path';
import { RedisService } from './redis/redis.service';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private lastFailure: string | undefined;
  constructor(
    private readonly dataSource: DataSource,
    @Optional() private readonly redis?: RedisService,
  ) {}
  @Get('live') live() {
    return { status: 'ok' };
  }
  @Get('ready') async ready() {
    let stage = 'redis';
    try {
      if (this.redis && !(await this.redis.ready())) throw new Error('dependency');
      stage = 'database_schema';
      // Representative schema/relations, not merely a socket or SELECT 1.
      await this.dataSource
        .query(`SELECT u.token_version,a.cancelled_at,p.reconciliation_status,
        mr.version,cv.status,dsr.interval_minutes,dse.closed,r.status FROM users u LEFT JOIN appointments a ON a.user_id=u.id
        LEFT JOIN payments p ON p.appointment_id=a.id LEFT JOIN medical_records mr ON mr.appointment_id=a.id
        LEFT JOIN clinic_visits cv ON cv.appointment_id=a.id
        LEFT JOIN doctor_schedule_rules dsr ON dsr.doctor_id=u.id
        LEFT JOIN doctor_schedule_exceptions dse ON dse.doctor_id=u.id
        LEFT JOIN appointment_reminders r ON r.appointment_id=a.id LIMIT 0`);
      stage = 'migration_files';
      const expected = readdirSync(join(__dirname, '..', 'migrations'))
        .filter((f) => /^\d{3}_.*\.sql$/.test(f))
        .sort();
      if (!expected.length) throw new Error('artifacts');
      stage = 'migration_history';
      const applied = await this.dataSource.query(
        'SELECT name FROM schema_migrations ORDER BY name',
      );
      if (
        expected.some(
          (name) => !applied.some((m: { name: string }) => m.name === name),
        )
      )
        throw new Error('schema');
      this.lastFailure = undefined;
      return { status: 'ready' };
    } catch (error) {
      // Dependency category + SQLSTATE only. Never log exception messages,
      // queries, connection strings, identifiers or clinical data.
      const code = (error as { code?: unknown } | null)?.code;
      const databaseStage = stage === 'database_schema' || stage === 'migration_history';
      const sqlState = databaseStage && typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)
        ? ` (SQLSTATE ${code})` : '';
      const failure = stage + sqlState;
      if (failure !== this.lastFailure) {
        this.logger.warn(`Readiness failed: ${failure}`);
        this.lastFailure = failure;
      }
      throw new ServiceUnavailableException('Dữ liệu hệ thống chưa sẵn sàng');
    }
  }
}
