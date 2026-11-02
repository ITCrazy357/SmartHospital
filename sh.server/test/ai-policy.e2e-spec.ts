import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { AiPolicyService, AI_POLICY_VERSION } from '../src/ai/ai-policy.service';
import { RequestLimitService } from '../src/common/rate-limit.service';
import { MedicalRecordEmbeddingsService } from '../src/medical-records/medical-record-embeddings.service';
const { runMigrations } = require('../scripts/migrate.cjs');

const testUrl = process.env.TEST_DATABASE_URL;
const integration = testUrl ? describe : describe.skip;

integration('AI consent and quotas on isolated PostgreSQL', () => {
  let client: Client;
  let second: Client;
  let schema: string;
  let ds: any;
  let policy: AiPolicyService;
  const actor = randomUUID();
  const patient = randomUUID();

  beforeAll(async () => {
    if (!new URL(testUrl!).pathname.toLowerCase().includes('test')) throw new Error('TEST_DATABASE_URL must name a disposable test database.');
    client = new Client({ connectionString: testUrl }); second = new Client({ connectionString: testUrl });
    await client.connect(); await second.connect();
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  });
  beforeEach(async () => {
    schema = `sh_test_${randomUUID().replace(/-/g, '')}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}",public`);
    await second.query(`SET search_path TO "${schema}",public`);
    await runMigrations(client, { log() {} });
    await client.query("INSERT INTO users(id,full_name,email,password_hash,role) VALUES ($1,'Doctor fixture','doctor@example.invalid','fixture','doctor'),($2,'Patient fixture','patient@example.invalid','fixture','user')", [actor, patient]);
    ds = {
      query: async (sql: string, args?: unknown[]) => (await client.query(sql, args)).rows,
      transaction: async (fn: (em: any) => Promise<unknown>) => {
        await client.query('BEGIN');
        try { const result = await fn(ds); await client.query('COMMIT'); return result; }
        catch (error) { await client.query('ROLLBACK'); throw error; }
      },
    };
    policy = new AiPolicyService(ds, { get: (key: string) => key === 'AI_ENABLED' ? 'true' : undefined } as any, new RequestLimitService(ds));
  });
  afterEach(async () => {
    await second.query('SET search_path TO public');
    await client.query('SET search_path TO public');
    if (schema) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
  });
  afterAll(async () => { if (second) await second.end(); if (client) await client.end(); });

  it('requires both toggles and records current consent/revocation with audit', async () => {
    expect((await policy.status(actor)).enabled).toBe(false);
    await policy.configure(actor, { enabled: true, confirmDataProcessing: true });
    expect((await policy.status(actor)).consented).toBe(false);
    await policy.consent(actor, { accepted: true, policyVersion: AI_POLICY_VERSION });
    expect((await policy.status(actor)).consented).toBe(true);
    await policy.revoke(actor);
    expect((await policy.status(actor)).consented).toBe(false);
    expect((await client.query('SELECT action FROM operation_audit ORDER BY created_at')).rows.map((r: any) => r.action)).toEqual(['ai.configure','ai.consent','ai.revoke']);
  });

  it('atomically admits one request across separate database clients', async () => {
    const one = new RequestLimitService(ds);
    const two = new RequestLimitService({ query: async (sql: string, args: unknown[]) => (await second.query(sql, args)).rows } as any);
    const result = await Promise.allSettled([one.consume('race', 1, 60), two.consume('race', 1, 60)]);
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await client.query("SELECT count FROM request_limits WHERE bucket='race'")).rows[0].count).toBe(1);
  });

  it('manual force backfill processes only records owned by the requesting doctor', async () => {
    const other = randomUUID();
    await client.query("INSERT INTO users(id,full_name,email,password_hash,role) VALUES ($1,'Other doctor','other@example.invalid','fixture','doctor')", [other]);
    const mine = await client.query("INSERT INTO medical_records(patient_id,doctor_id,symptoms) VALUES($1,$2,'Fixture A') RETURNING id", [patient, actor]);
    await client.query("INSERT INTO medical_records(patient_id,doctor_id,symptoms) VALUES($1,$2,'Fixture B')", [patient, other]);
    const embedding = new MedicalRecordEmbeddingsService(ds, {} as any, {} as any, { isConfigured: () => true } as any, {} as any, { allows: async () => true } as any);
    const embed = jest.spyOn(embedding, 'embedRecord').mockResolvedValue(true);
    const result = await embedding.backfill({ doctorId: actor, forceAll: true, limit: 100 });
    expect(result.succeeded).toBe(1);
    expect(embed).toHaveBeenCalledWith(mine.rows[0].id);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('revoked patient consent immediately excludes an existing RAG index', async () => {
    const record = (await client.query("INSERT INTO medical_records(patient_id,doctor_id,symptoms,embedding_status) VALUES($1,$2,'Fixture only','ready') RETURNING id", [patient, actor])).rows[0];
    await policy.consent(patient, { accepted: true, policyVersion: AI_POLICY_VERSION });
    const vector = `[${Array(1536).fill(0.025).join(',')}]`;
    await client.query('INSERT INTO medical_record_embeddings(record_id,doctor_id,patient_id,content_anonymized,embedding) VALUES($1,$2,$3,$4,$5::vector)', [record.id, actor, patient, 'Fixture only', vector]);
    const embedding = new MedicalRecordEmbeddingsService(ds, {} as any, {} as any, {} as any, {} as any, policy);
    expect(await embedding.searchByDoctor({ doctorId: actor, queryEmbedding: Array(1536).fill(0.025) })).toHaveLength(1);
    const unrelated = Array(1536).fill(0.025).map((value, index) => index % 2 ? -value : value);
    expect(await embedding.searchByDoctor({ doctorId: actor, queryEmbedding: unrelated })).toHaveLength(0);
    await policy.revoke(patient);
    expect(await embedding.searchByDoctor({ doctorId: actor, queryEmbedding: Array(1536).fill(0.025) })).toHaveLength(0);
  });
});
