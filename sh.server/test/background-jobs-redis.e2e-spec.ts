import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../src/redis/redis.service';
import { AppointmentsService } from '../src/appointments/appointments.service';

describe('background job coordination with real Redis', () => {
  const clients: RedisService[] = [];
  const prefix = `sh:test:${randomUUID()}`;

  function redis(url = process.env.TEST_REDIS_URL) {
    if (!url)
      throw new Error('TEST_REDIS_URL is required for Redis integration tests');
    const client = new RedisService(
      new ConfigService({
        REDIS_URL: url,
        REDIS_KEY_PREFIX: prefix,
        REDIS_TIMEOUT_MS: '100',
      }),
    );
    clients.push(client);
    return client;
  }

  function reconciliation(
    client: RedisService,
    provider: { getPayment: jest.Mock },
  ) {
    const scan = jest.fn(async () => [{ id: 'fixture', payosOrderCode: 123 }]);
    const qb: any = {};
    for (const method of ['where', 'andWhere', 'orderBy', 'take'])
      qb[method] = () => qb;
    qb.getMany = scan;
    const query = jest.fn(async () => []);
    const service = new AppointmentsService(
      {} as any,
      { createQueryBuilder: () => qb } as any,
      {} as any,
      { query } as any,
      { isConfigured: () => true, ...provider } as any,
      {} as any,
      client,
    );
    return { service, scan, query };
  }

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.onModuleDestroy()));
  });

  it('runs only one reconciliation scan and provider call across two replicas', async () => {
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: () => void;
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const provider = {
      getPayment: jest.fn(async () => {
        started();
        await blocked;
        return { status: 'PENDING' };
      }),
    };
    const a = reconciliation(redis(), provider);
    const b = reconciliation(redis(), provider);
    const first = a.service.cronReconcile();
    try {
      await Promise.race([
        entered,
        first.then(() => {
          throw new Error('First replica did not enter reconciliation');
        }),
      ]);
      await b.service.cronReconcile();
      expect(a.scan).toHaveBeenCalledTimes(1);
      expect(b.scan).not.toHaveBeenCalled();
      expect(b.query).not.toHaveBeenCalled();
      expect(provider.getPayment).toHaveBeenCalledTimes(1);
    } finally {
      finish();
      await first;
    }
    await b.service.cronReconcile();
    expect(b.scan).toHaveBeenCalledTimes(1);
    expect(provider.getPayment).toHaveBeenCalledTimes(2);
  });

  it('skips financial scans and provider work when configured Redis is unavailable', async () => {
    const provider = { getPayment: jest.fn() };
    const job = reconciliation(redis('redis://127.0.0.1:1/0'), provider);
    await job.service.cronReconcile();
    expect(job.scan).not.toHaveBeenCalled();
    expect(job.query).not.toHaveBeenCalled();
    expect(provider.getPayment).not.toHaveBeenCalled();
  });
});
