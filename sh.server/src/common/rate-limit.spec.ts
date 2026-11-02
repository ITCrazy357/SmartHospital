import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { RequestLimitService, RequestRateGuard } from './rate-limit.service';

describe('shared request limits', () => {
  it('uses Redis quotas without touching PostgreSQL when configured', async () => {
    const query = jest.fn();
    const consume = jest.fn().mockResolvedValue(true);
    const limits = new RequestLimitService({ query } as any, { isConfigured: () => true, isRequired: () => false, consume } as any);
    await limits.consume('fixture', 1, 60);
    consume.mockResolvedValue(false);
    await expect(limits.consume('fixture', 1, 60)).rejects.toMatchObject({ status: 429 });
    consume.mockRejectedValue(new ServiceUnavailableException());
    await expect(limits.consume('fixture', 1, 60)).rejects.toMatchObject({ status: 503 });
    expect(query).not.toHaveBeenCalled();
  });
  it('retains the shared database limiter only when Redis is unset and optional', async () => {
    const query = jest.fn().mockResolvedValue([{ count: 1 }]);
    const consume = jest.fn();
    const limits = new RequestLimitService({ query } as any, { isConfigured: () => false, isRequired: () => false, consume } as any);
    await limits.consume('fixture', 1, 60);
    expect(query).toHaveBeenCalledTimes(1);
    expect(consume).not.toHaveBeenCalled();
  });
  it('fails closed for required Redis with missing URL without splitting quota into PostgreSQL', async () => {
    const query = jest.fn();
    const limits = new RequestLimitService({ query } as any, { isConfigured: () => false, isRequired: () => true, consume: jest.fn().mockRejectedValue(new ServiceUnavailableException()) } as any);
    await expect(limits.consume('fixture', 1, 60)).rejects.toMatchObject({ status: 503 });
    expect(query).not.toHaveBeenCalled();
  });
  it('rejects a bucket at quota and fails closed on database failure', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const limits = new RequestLimitService({ query } as any);
    await expect(limits.consume('fixture', 1, 60)).rejects.toBeInstanceOf(HttpException);
    query.mockRejectedValue(new Error('db down'));
    await expect(limits.consume('fixture', 1, 60)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('uses Express trusted request.ip, ignoring forged forwarded headers', async () => {
    const consume = jest.fn().mockResolvedValue(undefined);
    const guard = new RequestRateGuard({ consume } as any);
    const req = { path: '/auth/login', method: 'POST', ip: '192.0.2.1', headers: { 'x-forwarded-for': '198.51.100.1' } };
    const context = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) } as any;
    await guard.canActivate(context);
    req.headers['x-forwarded-for'] = '203.0.113.2';
    await guard.canActivate(context);
    expect(consume.mock.calls[0][0]).toBe(consume.mock.calls[1][0]);
  });
  it('does not rate limit readiness probes', async () => {
    const consume = jest.fn();
    const guard = new RequestRateGuard({ consume } as any);
    await guard.canActivate({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ path: '/health/ready', method: 'GET' }) }) } as any);
    expect(consume).not.toHaveBeenCalled();
  });
});
