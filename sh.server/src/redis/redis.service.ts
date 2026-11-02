import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from 'redis';

type Client = ReturnType<typeof createClient>;
export type RedisClientFactory = (
  options: Parameters<typeof createClient>[0],
) => Client;
export const REDIS_CLIENT_FACTORY = Symbol('REDIS_CLIENT_FACTORY');
export interface RedisState {
  configured: boolean;
  required: boolean;
  ready: boolean;
}
export interface RedisLease {
  signal: AbortSignal;
  assertOwned: () => Promise<void>;
}
export type LeaseResult<T> = { acquired: false } | { acquired: true; value: T };

// One key, bounded integer count and a fixed expiration. Rejected attempts never
// extend the window or write an unbounded counter. No raw IP/user/content in keys.
const LIMIT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= tonumber(ARGV[1]) then return 0 end
count = redis.call('INCR', KEYS[1])
if count == 1 or redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 1`;
const RENEW = `if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) else return 0 end`;
const RELEASE = `if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end`;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly url: string;
  private readonly required: boolean;
  private readonly prefix: string;
  private readonly timeoutMs: number;
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;
  private retryAfter = 0;
  private closing = false;
  private readonly activeLeases = new Set<AbortController>();

  constructor(
    config: ConfigService,
    @Optional()
    @Inject(REDIS_CLIENT_FACTORY)
    private readonly factory: RedisClientFactory = createClient,
  ) {
    this.url = config.get<string>('REDIS_URL')?.trim() || '';
    this.required = config.get<string>('REDIS_REQUIRED') === 'true';
    this.prefix =
      config.get<string>('REDIS_KEY_PREFIX')?.trim() || 'smarthospital:v1';
    if (!/^[A-Za-z0-9:_-]{1,64}$/.test(this.prefix))
      throw new Error('REDIS_KEY_PREFIX không hợp lệ');
    const timeout = Number(config.get<string>('REDIS_TIMEOUT_MS') ?? '1000');
    if (!Number.isInteger(timeout) || timeout < 100 || timeout > 10000)
      throw new Error('REDIS_TIMEOUT_MS phải từ 100 đến 10000');
    this.timeoutMs = timeout;
    if (this.url) {
      try {
        if (!['redis:', 'rediss:'].includes(new URL(this.url).protocol))
          throw new Error();
      } catch {
        throw new Error('REDIS_URL phải là URL redis:// hoặc rediss:// hợp lệ');
      }
    }
  }

  isConfigured(): boolean {
    return Boolean(this.url);
  }
  isRequired(): boolean {
    return this.required;
  }
  state(): RedisState {
    return {
      configured: this.isConfigured(),
      required: this.required,
      ready: Boolean(this.client?.isReady),
    };
  }

  async onModuleInit(): Promise<void> {
    // Start even if Redis is unavailable so readiness can report a bounded 503.
    // Configured protection never silently switches to another quota backend.
    if (this.isConfigured()) await this.ready();
  }

  async ready(): Promise<boolean> {
    if (!this.isConfigured()) return !this.required;
    try {
      return (await this.execute((client) => client.ping())) === 'PONG';
    } catch {
      return false;
    }
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException(
      'Redis chưa sẵn sàng. Vui lòng thử lại sau.',
    );
  }

  private key(kind: string, name: string): string {
    return `${this.prefix}:${kind}:${createHash('sha256').update(name).digest('hex')}`;
  }

  private destroy(client: Client | null): void {
    if (!client) return;
    try {
      if (client.isOpen) client.destroy();
    } catch {
      /* already closed */
    }
    if (this.client === client) this.client = null;
  }

  private async bounded<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(this.unavailable()), this.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async connection(): Promise<Client> {
    if (this.closing || !this.isConfigured()) throw this.unavailable();
    if (this.client?.isReady) return this.client;
    if (this.connecting) return this.connecting;
    if (Date.now() < this.retryAfter) throw this.unavailable();
    this.destroy(this.client);
    let client: Client;
    try {
      client = this.factory({
        url: this.url,
        socket: { connectTimeout: this.timeoutMs, reconnectStrategy: false },
        disableOfflineQueue: true,
        commandsQueueMaxLength: 500,
      });
    } catch {
      this.retryAfter = Date.now() + this.timeoutMs;
      throw this.unavailable();
    }
    // The client must have an error listener; never print its error/connection URL.
    client.on('error', () => {});
    this.client = client;
    const attempt = this.bounded(client.connect())
      .then(() => {
        if (this.closing || !client.isReady) throw this.unavailable();
        this.retryAfter = 0;
        return client;
      })
      .catch(() => {
        this.destroy(client);
        this.retryAfter = Date.now() + this.timeoutMs;
        throw this.unavailable();
      });
    this.connecting = attempt;
    try {
      return await attempt;
    } finally {
      if (this.connecting === attempt) this.connecting = null;
    }
  }

  private async execute<T>(work: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.connection();
    try {
      return await this.bounded(work(client));
    } catch {
      this.destroy(client);
      this.retryAfter = Date.now() + this.timeoutMs;
      throw this.unavailable();
    }
  }

  async consume(
    bucket: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean> {
    if (
      !bucket ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      !Number.isSafeInteger(windowSeconds) ||
      windowSeconds < 1 ||
      windowSeconds > 31_536_000
    )
      throw new Error('Cấu hình giới hạn Redis không hợp lệ');
    const result = await this.execute((client) =>
      client.eval(LIMIT, {
        keys: [this.key('limit', bucket)],
        arguments: [String(limit), String(windowSeconds * 1000)],
      }),
    );
    if (Number(result) !== 0 && Number(result) !== 1) throw this.unavailable();
    return Number(result) === 1;
  }

  async withLease<T>(
    name: string,
    ttlMs: number,
    work: (lease: RedisLease) => Promise<T>,
  ): Promise<LeaseResult<T>> {
    if (
      !Number.isSafeInteger(ttlMs) ||
      ttlMs < 300 ||
      ttlMs > 3_600_000 ||
      !name
    )
      throw new Error('Redis lease không hợp lệ');
    if (!this.isConfigured()) {
      if (this.required) throw this.unavailable();
      return {
        acquired: true,
        value: await work({
          signal: new AbortController().signal,
          assertOwned: async () => {},
        }),
      };
    }
    const key = this.key('lease', name),
      token = randomUUID();
    const acquired = await this.execute((client) =>
      client.set(key, token, { NX: true, PX: ttlMs }),
    );
    if (acquired !== 'OK') return { acquired: false };
    const controller = new AbortController();
    this.activeLeases.add(controller);
    let renewing: Promise<void> | null = null;
    const lost = () => {
      if (!controller.signal.aborted) controller.abort();
    };
    const assertOwned = async () => {
      if (controller.signal.aborted || this.closing) throw this.unavailable();
      try {
        if ((await this.execute((client) => client.get(key))) !== token) {
          lost();
          throw this.unavailable();
        }
      } catch {
        lost();
        throw this.unavailable();
      }
    };
    const timer = setInterval(
      () => {
        if (renewing || controller.signal.aborted) return;
        renewing = this.execute((client) =>
          client.eval(RENEW, {
            keys: [key],
            arguments: [token, String(ttlMs)],
          }),
        )
          .then((result) => {
            if (Number(result) !== 1) lost();
          })
          .catch(lost)
          .finally(() => {
            renewing = null;
          });
      },
      Math.max(100, Math.floor(ttlMs / 3)),
    );
    timer.unref();
    try {
      const value = await work({ signal: controller.signal, assertOwned });
      await assertOwned();
      return { acquired: true, value };
    } finally {
      clearInterval(timer);
      this.activeLeases.delete(controller);
      if (renewing) await renewing;
      try {
        await this.execute((client) =>
          client.eval(RELEASE, { keys: [key], arguments: [token] }),
        );
      } catch {
        /* token-protected lease expires even when release cannot connect */
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    for (const controller of this.activeLeases) controller.abort();
    this.activeLeases.clear();
    this.destroy(this.client);
  }
}
