import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { createConnection, createServer, Socket } from 'node:net';
import { createClient } from 'redis';
import { RedisService } from '../src/redis/redis.service';

const testUrl = process.env.TEST_REDIS_URL;
const describeRedis = testUrl ? describe : describe.skip;
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describeRedis('Redis shared protection (isolated keys, real server)', () => {
  const prefix = `sh:test:${randomUUID()}`;
  const key = (kind: string, name: string) =>
    `${prefix}:${kind}:${createHash('sha256').update(name).digest('hex')}`;
  const config = new ConfigService({
    REDIS_URL: testUrl,
    REDIS_REQUIRED: 'true',
    REDIS_KEY_PREFIX: prefix,
    REDIS_TIMEOUT_MS: '1000',
  });
  const first = new RedisService(config);
  const second = new RedisService(config);
  const inspect = createClient({
    url: testUrl,
    socket: { reconnectStrategy: false, connectTimeout: 1000 },
    disableOfflineQueue: true,
  });
  inspect.on('error', () => {});
  const keys: string[] = [];
  beforeAll(async () => {
    await inspect.connect();
    expect(await first.ready()).toBe(true);
    expect(await second.ready()).toBe(true);
  });
  afterAll(async () => {
    // Delete only this suite's known keys. Never FLUSHDB/FLUSHALL or enumerate
    // another deployment's keys even if TEST_REDIS_URL points to shared Redis.
    if (!prefix.startsWith('sh:test:'))
      throw new Error('Unsafe Redis test prefix');
    if (inspect.isReady && keys.length) await inspect.del(keys);
    await first.onModuleDestroy();
    await second.onModuleDestroy();
    if (inspect.isOpen) inspect.destroy();
  });

  it('atomically shares one fixed quota across two instances and rejects without extending TTL', async () => {
    const bucket = `auth:${randomUUID()}`,
      bucketKey = key('limit', bucket);
    keys.push(bucketKey);
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        (index % 2 ? first : second).consume(bucket, 7, 2),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(7);
    expect(await inspect.get(bucketKey)).toBe('7');
    const ttl = await inspect.pTTL(bucketKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(2000);
    await delay(50);
    expect(await second.consume(bucket, 7, 2)).toBe(false);
    expect(await inspect.pTTL(bucketKey)).toBeLessThan(ttl);
  });

  it('expires the quota and admits a new window', async () => {
    const bucket = `expiry:${randomUUID()}`,
      bucketKey = key('limit', bucket);
    keys.push(bucketKey);
    expect(await first.consume(bucket, 1, 1)).toBe(true);
    expect(await second.consume(bucket, 1, 1)).toBe(false);
    await delay(1100);
    expect(await second.consume(bucket, 1, 1)).toBe(true);
    expect(await inspect.get(bucketKey)).toBe('1');
  });

  it('renews a lease while running and excludes another instance until release', async () => {
    const name = `job:${randomUUID()}`,
      leaseKey = key('lease', name);
    keys.push(leaseKey);
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release!: () => void;
    const finish = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = first.withLease(name, 300, async (lease) => {
      started();
      await finish;
      await lease.assertOwned();
      return 'first';
    });
    await entered;
    try {
      await delay(650);
      const otherWork = jest.fn();
      expect(await second.withLease(name, 300, otherWork)).toEqual({
        acquired: false,
      });
      expect(otherWork).not.toHaveBeenCalled();
    } finally {
      release();
    }
    expect(await work).toEqual({ acquired: true, value: 'first' });
    expect(await inspect.exists(leaseKey)).toBe(0);
    expect(await second.withLease(name, 300, async () => 'second')).toEqual({
      acquired: true,
      value: 'second',
    });
  });

  it('detects ownership loss and cannot delete or renew a replacement owner token', async () => {
    const name = `owner:${randomUUID()}`,
      leaseKey = key('lease', name);
    keys.push(leaseKey);
    await expect(
      first.withLease(name, 300, async (lease) => {
        await inspect.set(leaseKey, 'replacement-owner', { PX: 3000 });
        await delay(150);
        expect(lease.signal.aborted).toBe(true);
        await lease.assertOwned();
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(await inspect.get(leaseKey)).toBe('replacement-owner');
    expect(await inspect.pTTL(leaseKey)).toBeGreaterThan(2000);
  });

  it('bounds a real stalled socket and rejects protected work with 503', async () => {
    const sockets = new Set<import('node:net').Socket>();
    const stalled = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) =>
      stalled.listen(0, '127.0.0.1', resolve),
    );
    const address = stalled.address() as import('node:net').AddressInfo;
    const unavailable = new RedisService(
      new ConfigService({
        REDIS_URL: `redis://127.0.0.1:${address.port}`,
        REDIS_TIMEOUT_MS: '100',
      }),
    );
    try {
      expect(await unavailable.ready()).toBe(false);
      await expect(unavailable.consume('auth', 2, 60)).rejects.toMatchObject({
        status: 503,
      });
      const work = jest.fn();
      await expect(
        unavailable.withLease('reminders', 300, work),
      ).rejects.toMatchObject({ status: 503 });
      expect(work).not.toHaveBeenCalled();
    } finally {
      await unavailable.onModuleDestroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => stalled.close(() => resolve()));
    }
  });

  it('fails closed during connection loss and retains quota when Redis recovers', async () => {
    const upstreamUrl = new URL(testUrl!);
    const sockets = new Set<Socket>();
    const relay = createServer((incoming) => {
      const upstream = createConnection({
        host: upstreamUrl.hostname,
        port: Number(upstreamUrl.port || 6379),
      });
      for (const socket of [incoming, upstream]) {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => {
          incoming.destroy();
          upstream.destroy();
        });
      }
      incoming.pipe(upstream).pipe(incoming);
    });
    await new Promise<void>((resolve) => relay.listen(0, '127.0.0.1', resolve));
    const port = (relay.address() as import('node:net').AddressInfo).port;
    const relayUrl = new URL(testUrl!);
    relayUrl.hostname = '127.0.0.1';
    relayUrl.port = String(port);
    const service = new RedisService(
      new ConfigService({
        REDIS_URL: relayUrl.toString(),
        REDIS_KEY_PREFIX: prefix,
        REDIS_TIMEOUT_MS: '100',
      }),
    );
    const bucket = `recovery:${randomUUID()}`;
    keys.push(key('limit', bucket));
    const stop = async () => {
      for (const socket of sockets) socket.destroy();
      if (relay.listening)
        await new Promise<void>((resolve) => relay.close(() => resolve()));
    };
    try {
      expect(await service.ready()).toBe(true);
      expect(await service.consume(bucket, 1, 60)).toBe(true);
      await stop();
      expect(await service.ready()).toBe(false);
      await expect(service.consume(bucket, 1, 60)).rejects.toMatchObject({
        status: 503,
      });
      const work = jest.fn();
      await expect(
        service.withLease('outage-job', 300, work),
      ).rejects.toMatchObject({ status: 503 });
      expect(work).not.toHaveBeenCalled();
      await new Promise<void>((resolve) =>
        relay.listen(port, '127.0.0.1', resolve),
      );
      await delay(150);
      expect(await service.ready()).toBe(true);
      expect(await service.consume(bucket, 1, 60)).toBe(false);
    } finally {
      await service.onModuleDestroy();
      await stop();
    }
  });
});
