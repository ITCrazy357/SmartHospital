import { CanActivate, ExecutionContext, HttpException, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RequestLimitService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource, @Optional() private readonly redis?: RedisService) {}

  async consume(bucket: string, limit: number, windowSeconds: number): Promise<void> {
    if (this.redis?.isConfigured() || this.redis?.isRequired()) {
      const allowed = await this.redis.consume(bucket, limit, windowSeconds);
      if (!allowed) throw new HttpException('Đã vượt hạn mức yêu cầu. Vui lòng thử lại sau.', 429);
      return;
    }
    let rows: { count: number }[];
    try {
      rows = await this.dataSource.query(`INSERT INTO request_limits(bucket,count,resets_at)
        VALUES ($1,1,now()+($3::int * interval '1 second'))
        ON CONFLICT(bucket) DO UPDATE SET
          count=CASE WHEN request_limits.resets_at<=now() THEN 1 ELSE request_limits.count+1 END,
          resets_at=CASE WHEN request_limits.resets_at<=now() THEN EXCLUDED.resets_at ELSE request_limits.resets_at END
        WHERE request_limits.resets_at<=now() OR request_limits.count<$2
        RETURNING count`, [bucket, limit, windowSeconds]);
    } catch {
      throw new ServiceUnavailableException('Bộ giới hạn yêu cầu chưa sẵn sàng. Vui lòng thử lại sau.');
    }
    if (!rows.length) throw new HttpException('Đã vượt hạn mức yêu cầu. Vui lòng thử lại sau.', 429);
  }

  @Cron('0 10 * * * *')
  async cleanExpired(): Promise<void> {
    // Clean legacy buckets even when Redis is now enabled; they may remain from
    // a previous deployment. PostgreSQL is not an outage fallback for Redis.
    try { await this.dataSource.query("DELETE FROM request_limits WHERE resets_at<now()-interval '1 day'"); } catch { /* a request fails closed if DB is unavailable */ }
  }
}

@Injectable()
export class RequestRateGuard implements CanActivate {
  constructor(private readonly limits: RequestLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest();
    const route = String(req.path || req.url || '').split('?')[0].toLowerCase().replace(/\/+$/, '');
    const isAuth = req.method === 'POST' && ['/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password'].includes(route);
    const isAi = req.method === 'POST' && ['/ai/suggest-departments', '/ai/suggest-slots', '/ai/doctor/chat', '/medical-records/me/backfill-embeddings'].includes(route);
    if (!isAuth && !isAi) return true;
    // Express request.ip honors only the server's configured trust proxy policy.
    // Never parse client-supplied Forwarded/X-Forwarded-For directly.
    const key = createHash('sha256').update(`${route}:${req.ip || req.socket?.remoteAddress || 'unknown'}`).digest('hex');
    await this.limits.consume(`http:${key}`, route === '/auth/forgot-password' ? 5 : 30, 900);
    return true;
  }
}
