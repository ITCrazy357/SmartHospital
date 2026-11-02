import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RequestLimitService, RequestRateGuard } from './rate-limit.service';
import { RedisModule } from '../redis/redis.module';

@Global()
@Module({
  imports: [RedisModule],
  providers: [RequestLimitService, { provide: APP_GUARD, useClass: RequestRateGuard }],
  exports: [RequestLimitService],
})
export class RequestLimitModule {}
