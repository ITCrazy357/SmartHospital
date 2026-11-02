import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiUsageEntity } from '../models/ai-usage.model';
import { OpenAIService } from './openai.service';
import { AnonymizeService } from './anonymize.service';
import { AuthModule } from '../auth/auth.module';
import { RequestLimitModule } from '../common/rate-limit.module';
import { AiPolicyService } from './ai-policy.service';
import { AiPolicyController } from './ai-policy.controller';

/**
 * Module hạ tầng AI dùng chung cho mọi tính năng AI:
 *  - OpenAIService: wrap OpenAI SDK, log token + cost vào ai_usage.
 *  - AnonymizeService: bóc PII cơ bản (tên/SĐT/email) trước khi gửi text ra ngoài.
 *
 * Các module feature (suggest-departments, doctor-chat, ...) sẽ import module này
 * để tái sử dụng client + policy chống leak PII.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AiUsageEntity]), AuthModule, RequestLimitModule],
  controllers: [AiPolicyController],
  providers: [OpenAIService, AnonymizeService, AiPolicyService],
  exports: [OpenAIService, AnonymizeService, AiPolicyService],
})
export class AiModule {}
