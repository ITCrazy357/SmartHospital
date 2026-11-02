import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import * as models from '../src/models';
import { PasswordResetTokenEntity } from '../src/models/password-reset-token.model';
import { AdvertisementEntity } from '../src/models/advertisement.model';
import { S3UploadService } from '../src/common/s3-upload.service';
import { MailService } from '../src/auth/mail.service';
import { PayOSService } from '../src/payos/payos.service';
import { OpenAIService } from '../src/ai/openai.service';
import { RequestValidationPipe } from '../src/common/request-validation.pipe';
import { RedisService } from '../src/redis/redis.service';
const { runMigrations } = require('../scripts/migrate.cjs');
const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration('full application module and HTTP clinic workflow on disposable PostgreSQL', () => {
  let client: Client, db: DataSource, app: INestApplication, schema: string;
  const roles = ['admin', 'receptionist', 'doctor', 'cashier', 'user'] as const;
  type Role = typeof roles[number];
  const identities: Partial<Record<Role, string>> = {}, tokens: Partial<Record<Role, string>> = {};
  const password = 'FixturePassword123!';
  const priorEnvironment = { NODE_ENV: process.env.NODE_ENV, JWT_SECRET: process.env.JWT_SECRET, AI_ENABLED: process.env.AI_ENABLED,
    REDIS_URL: process.env.REDIS_URL, REDIS_REQUIRED: process.env.REDIS_REQUIRED, REDIS_KEY_PREFIX: process.env.REDIS_KEY_PREFIX };
  const external = jest.fn(async () => { throw new Error('An external provider must not be called by this smoke test'); });

  beforeAll(async () => {
    const target = new URL(url!);
    if (!target.pathname.toLowerCase().includes('test') || !['127.0.0.1', 'localhost'].includes(target.hostname)) {
      throw new Error('A local disposable TEST_DATABASE_URL is required');
    }
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'fixture-only-secret-for-real-http-tests';
    process.env.AI_ENABLED = 'false';
    client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 }); await client.connect();
    await client.query('CREATE EXTENSION IF NOT EXISTS vector'); await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    schema = `application_test_${randomUUID().replace(/-/g, '')}`;
    if (process.env.TEST_REDIS_URL) {
      const redisTarget = new URL(process.env.TEST_REDIS_URL);
      if (!['127.0.0.1', 'localhost'].includes(redisTarget.hostname)) throw new Error('A local disposable TEST_REDIS_URL is required');
      process.env.REDIS_URL = process.env.TEST_REDIS_URL;
      process.env.REDIS_REQUIRED = 'true';
      process.env.REDIS_KEY_PREFIX = schema;
    } else {
      delete process.env.REDIS_URL;
      delete process.env.REDIS_REQUIRED;
      delete process.env.REDIS_KEY_PREFIX;
    }
    await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}",public`);
    await runMigrations(client, { log() {} });
    db = new DataSource({ type: 'postgres', url, synchronize: false,
      entities: [...Object.values(models).filter(value => typeof value === 'function'), PasswordResetTokenEntity, AdvertisementEntity] as Function[],
      extra: { options: `-c search_path=${schema},public`, max: 10 } });
    await db.initialize();
    const hash = await bcrypt.hash(password, 4);
    for (const role of roles) {
      const [account] = await db.query(`INSERT INTO users(full_name,email,password_hash,role)
        VALUES($1,$2,$3,$4) RETURNING id`, [`Fixture ${role}`, `${role}@example.invalid`, hash, role]);
      identities[role] = account.id;
    }
    // Import after NODE_ENV=test so ConfigModule never reads a developer's .env.
    const { AppModule } = require('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource).useValue(db)
      .overrideProvider(S3UploadService).useValue({ upload: external, delete: external })
      .overrideProvider(MailService).useValue({ isConfigured: () => false,
        sendPasswordResetEmail: external, sendAppointmentReminderEmail: external })
      .overrideProvider(PayOSService).useValue({ isConfigured: () => false, ensurePaymentLink: external, getPayment: external })
      .overrideProvider(OpenAIService).useValue({ isConfigured: () => false, embed: external, chat: external })
      .compile();
    app = module.createNestApplication({ logger: false }); app.useGlobalPipes(new RequestValidationPipe()); await app.init();
    for (const role of roles) {
      const response = await request(app.getHttpServer()).post('/auth/login')
        .send({ email: `${role}@example.invalid`, password }).expect(201);
      expect(response.body.user.role).toBe(role);
      tokens[role] = response.body.access_token;
      expect(typeof tokens[role]).toBe('string');
    }
  }, 30000);

  afterAll(async () => {
    await app?.close();
    if (db?.isInitialized) await db.destroy();
    if (client) {
      await client.query('SET search_path TO public');
      if (schema) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
      await client.end();
    }
    for (const [key, previous] of Object.entries(priorEnvironment)) {
      if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
    }
  });

  const call = (role: Role, method: 'get' | 'post', path: string, body?: Record<string, unknown>) => {
    const pending = request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${tokens[role]}`);
    return body === undefined ? pending : pending.send(body);
  };

  it('boots the full provider graph, serves readiness, enforces admin roles and hides public credentials', async () => {
    if (process.env.TEST_REDIS_URL) {
      expect(app.get(RedisService).state()).toEqual({ configured: true, required: true, ready: true });
      expect(await db.query('SELECT * FROM request_limits')).toHaveLength(0);
    }
    await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
    await request(app.getHttpServer()).get('/health/ready').expect(200, { status: 'ready' });
    await request(app.getHttpServer()).get('/admin/users').expect(401);
    for (const role of ['user', 'doctor', 'cashier', 'receptionist'] as Role[]) {
      await call(role, 'get', '/admin/users').expect(403);
    }
    const managed = await call('admin', 'get', '/admin/users').expect(200);
    expect(managed.body.some((account: { role: string }) => account.role === 'receptionist')).toBe(true);
    const directory = await request(app.getHttpServer()).get('/doctors').expect(200);
    expect(directory.body).toHaveLength(1);
    for (const field of ['passwordHash', 'tokenVersion', 'email', 'phone']) expect(directory.body[0]).not.toHaveProperty(field);
    expect(external).not.toHaveBeenCalled();
  });

  it('fails readiness on missing scheduling schema even with a complete migration ledger', async () => {
    await db.query(`ALTER TABLE "${schema}".doctor_schedule_rules RENAME TO doctor_schedule_rules_unavailable`);
    try {
      const response = await request(app.getHttpServer()).get('/health/ready').expect(503);
      expect(response.body.statusCode).toBe(503);
      expect(JSON.stringify(response.body)).not.toContain('doctor_schedule_rules');
    } finally {
      await db.query(`ALTER TABLE "${schema}".doctor_schedule_rules_unavailable RENAME TO doctor_schedule_rules`);
    }
    await request(app.getHttpServer()).get('/health/ready').expect(200, { status: 'ready' });
  });

  it('carries a linked patient through reception, draft/final clinical record and cashier collection over HTTP', async () => {
    const patient = await call('receptionist', 'post', '/clinic/patients', {
      fullName: 'Linked HTTP fixture', userId: identities.user, phone: '0901234567',
    }).expect(201);
    const visit = await call('receptionist', 'post', '/clinic/visits', {
      patientId: patient.body.id, doctorId: identities.doctor, source: 'walk_in',
      scheduledAt: new Date().toISOString(), consultationFee: 100000, symptoms: 'Private fixture symptom',
    }).expect(201);
    const id = visit.body.id;
    await call('receptionist', 'post', `/clinic/visits/${id}/transition`, { version: 1, status: 'checked_in' }).expect(201);
    await call('receptionist', 'post', `/clinic/visits/${id}/encounter`, { version: 0, diagnosis: 'Forbidden fixture', reason: 'Fixture' }).expect(403);
    await call('doctor', 'post', `/clinic/visits/${id}/transition`, { version: 2, status: 'in_consultation' }).expect(201);
    const draft = await call('doctor', 'post', `/clinic/visits/${id}/encounter`, {
      version: 0, reason: 'Draft HTTP fixture', diagnosis: 'Fixture diagnosis', treatment: 'Fixture care',
      vitals: { heartRate: 70 }, notes: 'Private clinical fixture', finalize: false,
    }).expect(201);
    expect(draft.body.status).toBe('draft');
    const beforeFinal = await call('user', 'get', `/clinic/visits/${id}`).expect(200);
    expect(beforeFinal.body.encounter).toBeNull();
    const finalized = await call('doctor', 'post', `/clinic/visits/${id}/encounter`, {
      version: draft.body.version, reason: 'Confirmed HTTP fixture', diagnosis: 'Fixture diagnosis', treatment: 'Fixture care',
      vitals: { heartRate: 70 }, notes: 'Private clinical fixture', finalize: true,
    }).expect(201);
    expect(finalized.body.status).toBe('final');
    const ownRecord = await call('user', 'get', `/clinic/visits/${id}`).expect(200);
    expect(ownRecord.body.encounter.diagnosis).toBe('Fixture diagnosis');
    expect(ownRecord.body.visit.status).toBe('completed');
    const cashierView = await call('cashier', 'get', `/clinic/visits/${id}`).expect(200);
    expect(cashierView.body.encounter).toBeNull(); expect(cashierView.body.visit).not.toHaveProperty('symptoms');
    expect(cashierView.body.patient).not.toHaveProperty('allergies');
    expect(cashierView.body.legacyMedicalRecord).toBeNull();
    await call('cashier', 'post', `/clinic/visits/${id}/collections`, {
      amount: 100000, method: 'cash', idempotencyKey: randomUUID(), confirmed: true,
    }).expect(201);
    const collected = await call('cashier', 'get', `/clinic/visits/${id}`).expect(200);
    expect(collected.body.ledger).toHaveLength(1); expect(Number(collected.body.ledger[0].amount)).toBe(100000);
    await call('user', 'post', `/clinic/visits/${id}/collections`, {
      amount: 1, method: 'cash', idempotencyKey: randomUUID(), confirmed: true,
    }).expect(403);
    expect(external).not.toHaveBeenCalled();
  });
});
