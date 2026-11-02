import { Body, Controller, INestApplication, Logger, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { readdirSync } from 'fs';
import { join } from 'path';
import { HealthController } from './health.controller';
import { RequestValidationPipe } from './common/request-validation.pipe';
import { CreateDepartmentDto } from './departments/dto/departments.dto';
import { RedisService } from './redis/redis.service';

const saved = jest.fn();
@Controller('fixture')
class ValidationFixtureController {
  @Post('departments')
  create(@Body() body: CreateDepartmentDto) {
    saved(body);
    return { saved: true };
  }
}

describe('HTTP readiness and request validation boundary', () => {
  let app: INestApplication;
  const expected = readdirSync(join(__dirname, '..', 'migrations')).filter(
    (name) => /^\d{3}_.*\.sql$/.test(name),
  );
  const query = jest.fn();
  const redisReady = jest.fn();
  let warnings: jest.SpyInstance;
  beforeAll(async () => {
    warnings = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const module = await Test.createTestingModule({
      controllers: [HealthController, ValidationFixtureController],
      providers: [
        { provide: DataSource, useValue: { query } },
        { provide: RedisService, useValue: { ready: redisReady } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new RequestValidationPipe());
    await app.init();
  });
  beforeEach(() => {
    saved.mockClear();
    query.mockReset();
    redisReady.mockReset().mockResolvedValue(true);
    warnings.mockClear();
    query.mockImplementation(async (sql: string) =>
      sql.includes('schema_migrations')
        ? expected.map((name) => ({ name }))
        : [],
    );
  });
  afterAll(async () => {
    await app?.close();
    warnings.mockRestore();
  });

  it('serves a live probe without requiring a database query', async () => {
    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200, { status: 'ok' });
    expect(query).not.toHaveBeenCalled();
    expect(redisReady).not.toHaveBeenCalled();
  });
  describe('release identity', () => {
    let previousRenderRevision: string | undefined;
    let previousAppRevision: string | undefined;
    beforeEach(() => {
      previousRenderRevision = process.env.RENDER_GIT_COMMIT;
      previousAppRevision = process.env.APP_REVISION;
      delete process.env.RENDER_GIT_COMMIT;
      delete process.env.APP_REVISION;
      query.mockRejectedValue(new Error('unavailable fixture dependency'));
      redisReady.mockResolvedValue(false);
    });
    afterEach(() => {
      if (previousRenderRevision === undefined) delete process.env.RENDER_GIT_COMMIT;
      else process.env.RENDER_GIT_COMMIT = previousRenderRevision;
      if (previousAppRevision === undefined) delete process.env.APP_REVISION;
      else process.env.APP_REVISION = previousAppRevision;
    });
    it.each([
      [undefined, undefined, null],
      ['A'.repeat(40), 'b'.repeat(40), 'a'.repeat(40)],
      [undefined, 'b'.repeat(40), 'b'.repeat(40)],
      ['malformed-private-fixture', 'b'.repeat(40), null],
      ['', 'b'.repeat(40), null],
      ['a'.repeat(39), undefined, null],
      ['g'.repeat(40), undefined, null],
      ['a'.repeat(40) + '\n', undefined, null],
    ])('publishes only validated revision metadata (case %#)', async (renderRevision, appRevision, revision) => {
      if (renderRevision !== undefined) process.env.RENDER_GIT_COMMIT = renderRevision;
      if (appRevision !== undefined) process.env.APP_REVISION = appRevision;
      await request(app.getHttpServer())
        .get('/health/version')
        .expect('Cache-Control', 'no-store')
        .expect(200, { revision });
      expect(query).not.toHaveBeenCalled();
      expect(redisReady).not.toHaveBeenCalled();
      expect(warnings).not.toHaveBeenCalled();
    });
  });
  it('marks an unavailable Redis dependency unready without exposing its connection details', async () => {
    redisReady.mockResolvedValue(false);
    const response = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(response.body.statusCode).toBe(503);
    expect(query).not.toHaveBeenCalled();
  });
  it('requires representative schema and every migration for readiness', async () => {
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200, { status: 'ready' });
    expect(query.mock.calls[0][0]).toContain('u.token_version');
    expect(query.mock.calls[0][0]).toContain('clinic_visits');
    expect(query.mock.calls[0][0]).toContain('doctor_schedule_rules');
    expect(query.mock.calls[0][0]).toContain('doctor_schedule_exceptions');
    expect(query.mock.calls[0][0]).toContain('appointment_reminders');
    query.mockImplementation(async (sql: string) =>
      sql.includes('schema_migrations') ? [] : [],
    );
    await request(app.getHttpServer()).get('/health/ready').expect(503);
  });
  it('returns only a generic readiness error if a dependency or schema fails', async () => {
    query.mockRejectedValue(new Error('fixture private database detail'));
    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);
    expect(response.body.message).toBe('Dữ liệu hệ thống chưa sẵn sàng');
    expect(JSON.stringify(response.body)).not.toContain('private database');
  });
  it('logs dependency stages privately and suppresses repeated failures until recovery', async () => {
    await request(app.getHttpServer()).get('/health/ready').expect(200);
    redisReady.mockResolvedValue(false);
    await request(app.getHttpServer()).get('/health/ready').expect(503);
    await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(warnings).toHaveBeenCalledTimes(1);
    expect(warnings).toHaveBeenLastCalledWith('Readiness failed: redis');
    redisReady.mockResolvedValue(true);
    query.mockRejectedValue(Object.assign(new Error('private credential or patient detail'), { code: '42P01' }));
    await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(warnings).toHaveBeenLastCalledWith('Readiness failed: database_schema (SQLSTATE 42P01)');
    query.mockImplementation(async (sql: string) => sql.includes('schema_migrations') ? [] : []);
    await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(warnings).toHaveBeenLastCalledWith('Readiness failed: migration_history');
    expect(JSON.stringify(warnings.mock.calls)).not.toContain('private');
    query.mockImplementation(async (sql: string) => sql.includes('schema_migrations') ? expected.map(name => ({ name })) : []);
    await request(app.getHttpServer()).get('/health/ready').expect(200);
    redisReady.mockResolvedValue(false);
    await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(warnings).toHaveBeenCalledTimes(4);
  });
  it.each([{}, { name: null }, { name: 4 }, { name: 'Valid', role: 'admin' }])(
    'rejects invalid DTO %p over HTTP before saving',
    async (body) => {
      await request(app.getHttpServer())
        .post('/fixture/departments')
        .send(body)
        .expect(400);
      expect(saved).not.toHaveBeenCalled();
    },
  );
  it('accepts a valid DTO over HTTP', async () => {
    await request(app.getHttpServer())
      .post('/fixture/departments')
      .send({ name: 'Fixture department', description: null })
      .expect(201, { saved: true });
    expect(saved).toHaveBeenCalledWith({
      name: 'Fixture department',
      description: null,
    });
  });
});
