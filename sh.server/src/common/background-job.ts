import type { RedisService } from '../redis/redis.service';

export interface BackgroundJobLease {
  signal: AbortSignal;
  assertOwned(): Promise<void>;
}

/**
 * Redis coordinates scans across replicas; database locks and write idempotency
 * remain authoritative. A configured Redis outage skips the job rather than
 * running the callback without coordination.
 */
export async function runBackgroundJob(
  redis: RedisService | undefined,
  name: string,
  ttlMs: number,
  work: (lease?: BackgroundJobLease) => Promise<unknown>,
  logger: { warn(message: string): void },
): Promise<void> {
  try {
    if (redis) {
      await redis.withLease(name, ttlMs, work);
    } else {
      // Backward-compatible direct construction in tests or a deployment with
      // Redis disabled. The existing PostgreSQL protections still apply.
      await work();
    }
  } catch {
    // Do not log provider/Redis errors: URLs and exception details may contain
    // credentials, patient identifiers or query contents.
    logger.warn(
      `Background job ${name} did not finish; it will retry on its next scheduled run.`,
    );
  }
}
