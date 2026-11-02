import { Body, Controller, INestApplication, Post } from '@nestjs/common';
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
  beforeAll(async () => {
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
    query.mockImplementation(async (sql: string) =>
      sql.includes('schema_migrations')
        ? expected.map((name) => ({ name }))
        : [],
    );
  });
  afterAll(async () => {
    await app?.close();
  });

  it('serves a live probe without requiring a database query', async () => {
    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200, { status: 'ok' });
    expect(query).not.toHaveBeenCalled();
    expect(redisReady).not.toHaveBeenCalled();
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
