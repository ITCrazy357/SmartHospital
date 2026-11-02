import { Controller, Get, Optional, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { readdirSync } from 'fs';
import { join } from 'path';
import { RedisService } from './redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    @Optional() private readonly redis?: RedisService,
  ) {}
  @Get('live') live() {
    return { status: 'ok' };
  }
  @Get('ready') async ready() {
    try {
      if (this.redis && !(await this.redis.ready())) throw new Error('dependency');
      // Representative schema/relations, not merely a socket or SELECT 1.
      await this.dataSource
        .query(`SELECT u.token_version,a.cancelled_at,p.reconciliation_status,
        mr.version,cv.status FROM users u LEFT JOIN appointments a ON a.user_id=u.id
        LEFT JOIN payments p ON p.appointment_id=a.id LEFT JOIN medical_records mr ON mr.appointment_id=a.id
        LEFT JOIN clinic_visits cv ON cv.appointment_id=a.id LIMIT 0`);
      const expected = readdirSync(join(__dirname, '..', 'migrations'))
        .filter((f) => /^\d{3}_.*\.sql$/.test(f))
        .sort();
      const applied = await this.dataSource.query(
        'SELECT name FROM schema_migrations ORDER BY name',
      );
      if (
        !expected.length ||
        expected.some(
          (name) => !applied.some((m: { name: string }) => m.name === name),
        )
      )
        throw new Error('schema');
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('Dữ liệu hệ thống chưa sẵn sàng');
    }
  }
}
