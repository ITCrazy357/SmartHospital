import { BadRequestException, ForbiddenException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { RequestLimitService } from '../common/rate-limit.service';

export const AI_POLICY_VERSION = '2026-11-01';
export const AI_DISCLOSURE = 'Khi bật AI, nội dung triệu chứng/câu hỏi và đoạn hồ sơ liên quan sau khi giảm thông tin định danh sẽ được gửi tới OpenAI để xử lý. Bộ lọc không bảo đảm xóa mọi thông tin định danh. AI có thể sai; việc khám và ghi hồ sơ vẫn sử dụng được khi từ chối hoặc thu hồi đồng ý. Việc bật AI của quản trị không thay thế đồng ý của từng người dùng.';

@Injectable()
export class AiPolicyService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly limits: RequestLimitService,
  ) {}

  async status(userId?: string) {
    const rows = await this.dataSource.query("SELECT value FROM system_config WHERE key='ai_enabled'");
    const deploymentEnabled = this.config.get<string>('AI_ENABLED') === 'true';
    const consented = userId ? await this.hasConsent(userId) : false;
    return { enabled: deploymentEnabled && rows[0]?.value === 'true', deploymentEnabled, policyVersion: AI_POLICY_VERSION, consented, disclosure: AI_DISCLOSURE };
  }

  async hasConsent(userId: string): Promise<boolean> {
    const rows = await this.dataSource.query(`SELECT 1 FROM ai_consents c JOIN users u ON u.id=c.user_id
      WHERE c.user_id=$1 AND c.policy_version=$2 AND c.revoked_at IS NULL AND u.is_locked=false`, [userId, AI_POLICY_VERSION]);
    return rows.length > 0;
  }

  async consent(userId: string, body: { accepted?: boolean; policyVersion?: string }) {
    if (body.accepted !== true || body.policyVersion !== AI_POLICY_VERSION) throw new BadRequestException('Phải xác nhận đúng phiên bản chính sách xử lý dữ liệu AI.');
    await this.dataSource.transaction(async em => {
      await em.query(`INSERT INTO ai_consents(user_id,policy_version) VALUES ($1,$2)
        ON CONFLICT(user_id) DO UPDATE SET policy_version=$2,granted_at=now(),revoked_at=NULL`, [userId, AI_POLICY_VERSION]);
      await em.query("INSERT INTO operation_audit(actor_id,action,entity_id,detail) VALUES ($1,'ai.consent',$3,$2::jsonb)", [userId, JSON.stringify({ policyVersion: AI_POLICY_VERSION }), userId]);
    });
    return this.status(userId);
  }

  async revoke(userId: string) {
    await this.dataSource.transaction(async em => {
      await em.query('UPDATE ai_consents SET revoked_at=now() WHERE user_id=$1', [userId]);
      await em.query("INSERT INTO operation_audit(actor_id,action,entity_id) VALUES ($1,'ai.revoke',$2)", [userId, userId]);
    });
    return this.status(userId);
  }

  async configure(actorId: string, body: { enabled?: boolean; confirmDataProcessing?: boolean }) {
    if (typeof body.enabled !== 'boolean' || (body.enabled && body.confirmDataProcessing !== true)) throw new BadRequestException('Cần xác nhận phạm vi xử lý dữ liệu trước khi bật AI.');
    if (body.enabled && this.config.get<string>('AI_ENABLED') !== 'true') throw new BadRequestException('AI_ENABLED chưa được bật tại môi trường triển khai.');
    await this.dataSource.transaction(async em => {
      await em.query("INSERT INTO system_config(key,value,updated_by) VALUES ('ai_enabled',$1,$2) ON CONFLICT(key) DO UPDATE SET value=$1,updated_by=$2,updated_at=now()", [String(body.enabled), actorId]);
      await em.query("INSERT INTO operation_audit(actor_id,action,entity_id,detail) VALUES ($1,'ai.configure','ai_enabled',$2::jsonb)", [actorId, JSON.stringify({ enabled: body.enabled })]);
    });
    return this.status(actorId);
  }

  async allows(userId: string): Promise<boolean> {
    const state = await this.status(userId);
    return state.enabled && state.consented;
  }

  async authorize(userId: string, subjectIds: string[] = []): Promise<void> {
    const state = await this.status(userId);
    if (!state.enabled) throw new ServiceUnavailableException('AI đang tắt. Bạn vẫn có thể sử dụng các chức năng khám thông thường.');
    if (!state.consented) throw new ForbiddenException('Cần đồng ý chính sách xử lý dữ liệu AI trước khi sử dụng.');
    for (const subjectId of new Set(subjectIds)) {
      if (subjectId !== userId && !await this.hasConsent(subjectId)) throw new ForbiddenException('Hồ sơ chưa có đồng ý xử lý dữ liệu AI hợp lệ.');
    }
    await this.limits.consume(`ai:user:${userId}`, this.limit('AI_REQUESTS_PER_HOUR', 30, 1000), 3600);
    await this.limits.consume('ai:global:daily', this.limit('AI_DAILY_REQUEST_LIMIT', 1000, 100000), 86400);
  }

  async claimEmbedding(recordId: string, version: number): Promise<boolean> {
    try {
      // An expiring DB reservation survives worker restarts and bounds duplicate
      // calls across replicas, while allowing retry after a worker crash.
      await this.limits.consume(`embedding:${recordId}:${version}`, 1, 900);
      return true;
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 429) return false;
      throw error;
    }
  }

  ragMaxDistance(): number {
    const value = Number(this.config.get<string>('AI_RAG_MAX_DISTANCE') ?? '0.35');
    // An operator-tunable retrieval filter, not a calibrated clinical confidence.
    return Number.isFinite(value) && value >= 0 && value <= 2 ? value : 0.35;
  }

  private limit(key: string, fallback: number, max: number): number {
    const parsed = Number(this.config.get<string>(key) ?? fallback);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
  }
}
