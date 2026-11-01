import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { getMetadataArgsStorage } from 'typeorm';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { jwtSecret } from './jwt-config';
import { AdminController } from '../admin/admin.controller';
import { AdminService } from '../admin/admin.service';
import { AdminAiUsageService } from '../admin/admin-ai-usage.service';
import { S3UploadService } from '../common/s3-upload.service';
import { UserEntity } from '../models/user.model';
import { publicDoctor } from '../doctors/public-doctor.dto';

@Roles('admin')
class RestrictedController {
  adminOnly() {}
  @Roles('doctor') doctorOverride() {}
}

function context(handler: string, role?: string) {
  return {
    getClass: () => RestrictedController,
    getHandler: () => RestrictedController.prototype[handler],
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
  } as ExecutionContext;
}

describe('role metadata', () => {
  const guard = new RolesGuard(new Reflector());
  it.each(['user', 'doctor', 'receptionist', 'cashier', undefined])('blocks %s from a class-level admin route', role => {
    expect(() => guard.canActivate(context('adminOnly', role))).toThrow(ForbiddenException);
  });
  it('allows the class role and respects a method override', () => {
    expect(guard.canActivate(context('adminOnly', 'admin'))).toBe(true);
    expect(guard.canActivate(context('doctorOverride', 'doctor'))).toBe(true);
    expect(() => guard.canActivate(context('doctorOverride', 'admin'))).toThrow(ForbiddenException);
  });
});

describe('actual admin HTTP boundary with fixture authentication', () => {
  let app: INestApplication;
  const createManagedUser = jest.fn().mockResolvedValue({ id: 'created' });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [RolesGuard, { provide: AdminService, useValue: { createManagedUser, findAllUsers: () => [] } },
        { provide: AdminAiUsageService, useValue: {} }, { provide: S3UploadService, useValue: {} }],
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate(ctx: ExecutionContext) {
        const req = ctx.switchToHttp().getRequest();
        const role = req.headers['x-fixture-role'];
        if (!role) throw new UnauthorizedException();
        req.user = { id: 'fixture', role };
        return true;
      },
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => app?.close());
  it('rejects anonymous requests', async () => {
    await request(app.getHttpServer()).get('/admin/users').expect(401);
  });
  it.each(['user', 'doctor', 'receptionist', 'cashier'])('rejects %s trying to create an administrator', async role => {
    await request(app.getHttpServer()).post('/admin/users').set('x-fixture-role', role)
      .send({ email: 'admin@example.test', fullName: 'Fixture', password: 'Example123!', role: 'admin' }).expect(403);
    expect(createManagedUser).not.toHaveBeenCalled();
  });
  it('allows admin read access', async () => {
    await request(app.getHttpServer()).get('/admin/users').set('x-fixture-role', 'admin').expect(200, []);
  });
});

describe('safe public user serialization', () => {
  it('excludes credential columns from default ORM selects', () => {
    for (const propertyName of ['passwordHash', 'tokenVersion']) {
      const column = getMetadataArgsStorage().columns.find(c => c.target === UserEntity && c.propertyName === propertyName);
      expect(column?.options.select).toBe(false);
    }
  });
  it('allowlists doctor fields even if an entity has credentials and extra nested properties', () => {
    const doctor = Object.assign(new UserEntity(), {
      id: 'doctor', fullName: 'Fixture Doctor', createdAt: new Date('2026-01-01'),
      passwordHash: 'fixture-only', tokenVersion: 3, email: 'private@example.test', phone: '0912345678',
      preferredTimePattern: { totalSamples: 5 }, department: { id: 'dept', name: 'Khoa', description: null, secret: 'hidden' },
    });
    const result = JSON.parse(JSON.stringify(publicDoctor(doctor)));
    for (const hidden of ['passwordHash', 'tokenVersion', 'email', 'phone', 'preferredTimePattern']) {
      expect(result).not.toHaveProperty(hidden);
    }
    expect(result.department).toEqual({ id: 'dept', name: 'Khoa', description: null });
  });
});

describe('sessions and credential changes', () => {
  const password = 'Example123!';
  let hash: string;
  beforeAll(async () => { hash = await bcrypt.hash(password, 4); });
  function setup(overrides = {}) {
    const user = { id: 'fixture-user', email: 'user@example.test', fullName: 'Fixture', role: 'user',
      phone: null, avatarUrl: null, passwordHash: hash, tokenVersion: 2, isLocked: false, ...overrides };
    const qb = { addSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue(user) };
    const repo = { createQueryBuilder: () => qb, increment: jest.fn().mockResolvedValue({ affected: 1 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const resets = { delete: jest.fn().mockResolvedValue({ affected: 0 }) };
    const jwt = { sign: jest.fn().mockReturnValue('fixture-token') };
    const service = new AuthService(repo as any, resets as any, jwt as any, {} as any);
    return { service, user, qb, repo, jwt, resets };
  }
  it('explicitly selects password and version at login, emits version without exposing credentials', async () => {
    const { service, qb, jwt } = setup();
    const result = await service.login({ email: ' USER@example.test ', password });
    expect(qb.addSelect).toHaveBeenCalledWith(['u.passwordHash', 'u.tokenVersion']);
    expect(jwt.sign).toHaveBeenCalledWith({ sub: 'fixture-user', email: 'user@example.test', ver: 2 });
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.user).not.toHaveProperty('tokenVersion');
  });
  it.each(['user', 'doctor', 'admin', 'receptionist', 'cashier'])('rejects locked %s at login and JWT validation', async role => {
    const { service } = setup({ role, isLocked: true });
    await expect(service.login({ email: 'user@example.test', password })).rejects.toThrow(ForbiddenException);
    await expect(service.validateUserById('fixture-user', 2)).resolves.toBeNull();
  });
  it('rejects missing/old version and accepts the current version', async () => {
    const { service } = setup();
    await expect(service.validateUserById('fixture-user')).resolves.toBeNull();
    await expect(service.validateUserById('fixture-user', 1)).resolves.toBeNull();
    await expect(service.validateUserById('fixture-user', 2)).resolves.toMatchObject({ id: 'fixture-user' });
  });
  it('forwards the JWT version to account validation', async () => {
    const auth = { validateUserById: jest.fn().mockResolvedValue(null) };
    const strategy = new JwtStrategy(new ConfigService({ JWT_SECRET: 'fixture-secret' }), auth as any);
    await expect(strategy.validate({ sub: 'fixture-user', email: 'user@example.test', ver: 1 })).rejects.toThrow(UnauthorizedException);
    expect(auth.validateUserById).toHaveBeenCalledWith('fixture-user', 1);
  });
  it('increments the version atomically on logout', async () => {
    const { service, repo } = setup();
    await service.logout('fixture-user');
    expect(repo.increment).toHaveBeenCalledWith({ id: 'fixture-user' }, 'tokenVersion', 1);
  });
  it('changes passwords with an old-hash compare and atomic version increment', async () => {
    const { service, repo, resets } = setup();
    await service.changeMyPassword('fixture-user', password, 'Different123!', 'Different123!');
    const [criteria, changes] = repo.update.mock.calls[0];
    expect(criteria).toMatchObject({ id: 'fixture-user', passwordHash: hash, isLocked: false });
    expect(await bcrypt.compare('Different123!', changes.passwordHash)).toBe(true);
    expect(changes.tokenVersion()).toBe('token_version + 1');
    expect(resets.delete).toHaveBeenCalledWith({ userId: 'fixture-user' });
  });
  it('does not overwrite credentials if another request changed the old password', async () => {
    const { service, repo } = setup();
    repo.update.mockResolvedValueOnce({ affected: 0 });
    await expect(service.changeMyPassword('fixture-user', password, 'Different123!', 'Different123!')).rejects.toThrow('Tài khoản vừa thay đổi');
  });
});

describe('JWT startup configuration', () => {
  it.each([undefined, '', 'short', 'smart-hospital-secret-change-in-production'])('rejects unsafe production secret %s', secret => {
    expect(() => jwtSecret(new ConfigService({ NODE_ENV: 'production', JWT_SECRET: secret }))).toThrow();
  });
  it('accepts configured production secret and keeps a process-local development key', () => {
    expect(jwtSecret(new ConfigService({ NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(48) }))).toBe('a'.repeat(48));
    expect(jwtSecret(new ConfigService({}))).toBe(jwtSecret(new ConfigService({})));
    expect(jwtSecret(new ConfigService({}))).not.toBe('smart-hospital-secret-change-in-production');
  });
});

describe('deactivate users without cascading clinical data', () => {
  function setup(role = 'user', admins = 2) {
    const em = { query: jest.fn(), findOne: jest.fn().mockResolvedValue({ id: 'patient', role, isLocked: false }),
      count: jest.fn().mockResolvedValue(admins), update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const repo = { remove: jest.fn() };
    const svc = new AdminService(repo as any, {} as any, {} as any, {} as any,
      { transaction: fn => fn(em) } as any, {} as any);
    return { svc, em, repo };
  }
  it('deactivates a patient while preserving their linked rows', async () => {
    const { svc, em, repo } = setup();
    await svc.deleteManagedUser('admin', 'patient');
    expect(em.update).toHaveBeenCalledWith(UserEntity, { id: 'patient' }, expect.objectContaining({ isLocked: true }));
    expect(repo.remove).not.toHaveBeenCalled();
  });
  it('blocks disabling the last active admin and self-deactivation', async () => {
    const { svc, em } = setup('admin', 1);
    await expect(svc.deleteManagedUser('other-admin', 'patient')).rejects.toThrow('admin hoạt động cuối cùng');
    expect(em.update).not.toHaveBeenCalled();
    await expect(svc.deleteManagedUser('patient', 'patient')).rejects.toThrow(ForbiddenException);
  });
  it('reactivates an account while invalidating its old tokens', async () => {
    const { svc, em } = setup('cashier');
    await svc.setManagedUserLocked('admin', 'patient', false);
    const changes = em.update.mock.calls[0][2];
    expect(changes.isLocked).toBe(false);
    expect(changes.tokenVersion()).toBe('token_version + 1');
  });
});
