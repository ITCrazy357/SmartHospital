import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RequestLimitService, RequestRateGuard } from './rate-limit.service';

@Global()
@Module({
  providers: [RequestLimitService, { provide: APP_GUARD, useClass: RequestRateGuard }],
  exports: [RequestLimitService],
})
export class RequestLimitModule {}
