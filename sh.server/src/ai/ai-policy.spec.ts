import { BadRequestException, ForbiddenException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { AiPolicyService, AI_POLICY_VERSION } from './ai-policy.service';

function fixture({ enabled = true, consented = true, deployment = 'true' } = {}) {
  const query = jest.fn(async (sql: string, args?: unknown[]) => {
    if (sql.includes('SELECT value')) return [{ value: String(enabled) }];
    if (sql.includes('SELECT 1 FROM ai_consents')) return consented && args?.[0] !== 'no-consent' ? [{}] : [];
    return [];
  });
  const limits = { consume: jest.fn().mockResolvedValue(undefined) };
  const ds = { query, transaction: async (fn: (em: unknown) => unknown) => fn({ query }) };
  const policy = new AiPolicyService(ds as any, { get: (key: string) => key === 'AI_ENABLED' ? deployment : undefined } as any, limits as any);
  return { policy, query, limits };
}

describe('external AI policy', () => {
  it('fails closed when the deployment kill switch is off', async () => {
    const f = fixture({ deployment: 'false' });
    await expect(f.policy.authorize('actor')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(f.limits.consume).not.toHaveBeenCalled();
  });
  it('fails closed when database toggle is off', async () => {
    const f = fixture({ enabled: false });
    await expect(f.policy.authorize('actor')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('requires current non-revoked consent for actor and every patient', async () => {
    const f = fixture();
    await expect(f.policy.authorize('actor', ['no-consent'])).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.limits.consume).not.toHaveBeenCalled();
    expect(f.query.mock.calls.some(([sql]) => sql.includes('revoked_at IS NULL') && sql.includes('u.is_locked=false'))).toBe(true);
  });
  it('reserves both actor and shared global quotas before external work', async () => {
    const f = fixture();
    await f.policy.authorize('actor', ['patient']);
    expect(f.limits.consume.mock.calls).toEqual([['ai:user:actor', 30, 3600], ['ai:global:daily', 1000, 86400]]);
  });
  it('does not accept an outdated or unchecked consent', async () => {
    const f = fixture();
    await expect(f.policy.consent('actor', { accepted: true, policyVersion: 'outdated' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(f.policy.consent('actor', { accepted: false, policyVersion: AI_POLICY_VERSION })).rejects.toBeInstanceOf(BadRequestException);
    expect(f.query).not.toHaveBeenCalled();
  });
  it('requires explicit data-processing confirmation before admin enable', async () => {
    const f = fixture();
    await expect(f.policy.configure('actor', { enabled: true })).rejects.toBeInstanceOf(BadRequestException);
    expect(f.query).not.toHaveBeenCalled();
  });
  it('deduplicates same record/version processing across workers using an expiring reservation', async () => {
    const f = fixture();
    expect(await f.policy.claimEmbedding('record', 2)).toBe(true);
    expect(f.limits.consume).toHaveBeenCalledWith('embedding:record:2', 1, 900);
    f.limits.consume.mockRejectedValue(new HttpException('busy', 429));
    expect(await f.policy.claimEmbedding('record', 2)).toBe(false);
    f.limits.consume.mockRejectedValue(new ServiceUnavailableException());
    await expect(f.policy.claimEmbedding('record', 2)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
