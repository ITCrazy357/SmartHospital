import type { EntityManager } from 'typeorm';

/** All schedule/appointment mutations acquire this before row locks. */
export async function lockDoctor(em: EntityManager, doctorId: string): Promise<void> {
  await em.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`doctor:${doctorId}`]);
}
