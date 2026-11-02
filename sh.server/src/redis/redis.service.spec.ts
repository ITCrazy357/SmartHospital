import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisClientFactory, RedisService } from './redis.service';

function fixture(
  overrides: Record<string, unknown> = {},
  env: Record<string, string> = {},
) {
  const client = {
    isReady: true,
    isOpen: true,
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue('PONG'),
    eval: jest.fn().mockResolvedValue(1),
    destroy: jest.fn(),
    ...overrides,
  };
  const factory = jest.fn(
    () => client,
  ) as unknown as jest.MockedFunction<RedisClientFactory>;
  const service = new RedisService(
    new ConfigService({
      REDIS_URL: 'redis://localhost:6379',
      REDIS_TIMEOUT_MS: '100',
      ...env,
    }),
    factory,
  );
  return { service, client, factory };
}

describe('Redis protection', () => {
  it('keeps optional Redis disabled and blocks required missing configuration', async () => {
    const optional = new RedisService(new ConfigService({}));
    expect(optional.state()).toEqual({
      configured: false,
      required: false,
      ready: false,
    });
    expect(await optional.ready()).toBe(true);
    expect(await optional.withLease('job', 1000, async () => 'done')).toEqual({
      acquired: true,
      value: 'done',
    });
    const required = new RedisService(
      new ConfigService({ REDIS_REQUIRED: 'true' }),
    );
    expect(await required.ready()).toBe(false);
    const work = jest.fn();
    await expect(required.withLease('job', 1000, work)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(required.consume('auth', 2, 60)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(work).not.toHaveBeenCalled();
  });

  it('does not queue/replay offline commands and hashes bucket identifiers', async () => {
    const { service, client, factory } = fixture();
    expect(await service.consume('auth:patient@example.invalid', 2, 60)).toBe(
      true,
    );
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        disableOfflineQueue: true,
        socket: { connectTimeout: 100, reconnectStrategy: false },
      }),
    );
    expect(client.eval).toHaveBeenCalledWith(expect.any(String), {
      keys: [expect.stringMatching(/^smarthospital:v1:limit:[0-9a-f]{64}$/)],
      arguments: ['2', '60000'],
    });
    client.eval.mockResolvedValue(0);
    expect(await service.consume('auth:patient@example.invalid', 2, 60)).toBe(
      false,
    );
    await service.onModuleDestroy();
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it('bounds unavailable connections and suppresses connection secrets', async () => {
    const { service, client } = fixture({
      connect: jest
        .fn()
        .mockRejectedValue(new Error('redis://user:password@host')),
    });
    await expect(service.consume('auth', 2, 60)).rejects.toMatchObject({
      status: 503,
    });
    expect(await service.ready()).toBe(false);
    expect(client.connect).toHaveBeenCalledTimes(1);
    await service.onModuleDestroy();
  });

  it('sanitizes client construction failures before protected requests see them', async () => {
    const service = new RedisService(
      new ConfigService({ REDIS_URL: 'redis://localhost:6379' }),
      () => {
        throw new Error('redis://user:password@private-host');
      },
    );
    await expect(service.consume('auth', 1, 60)).rejects.toMatchObject({
      status: 503,
    });
    await service.onModuleDestroy();
  });

  it('times out stalled commands, destroys the client, and never admits quota on failure', async () => {
    const { service, client } = fixture({
      eval: jest.fn(() => new Promise(() => {})),
    });
    await expect(service.consume('auth', 2, 60)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(client.destroy).toHaveBeenCalled();
    await service.onModuleDestroy();
  });

  it('reports an outage after a successful connection without leaking raw errors', async () => {
    const { service, client } = fixture();
    expect(await service.ready()).toBe(true);
    client.eval.mockRejectedValue(
      new Error('internal private connection details'),
    );
    try {
      await service.consume('auth', 2, 60);
      throw new Error('should fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(String(error)).not.toContain('private connection');
    }
    expect(await service.ready()).toBe(false);
    await service.onModuleDestroy();
  });
});
