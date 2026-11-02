import { createHash, randomBytes, randomUUID } from 'crypto';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as models from '../src/models';
import { UserEntity, AppointmentEntity, AppointmentSlotEntity, MedicalRecordEntity, DoctorScheduleEntity } from '../src/models';
import { PasswordResetTokenEntity } from '../src/models/password-reset-token.model';
import { AuthService } from '../src/auth/auth.service';
import { AdminService } from '../src/admin/admin.service';
import { DoctorsService } from '../src/doctors/doctors.service';
const { runMigrations } = require('../scripts/migrate.cjs');
const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration('credential revocation and data preservation on disposable PostgreSQL', () => {
  let ds: DataSource, admin: Client, schema: string, auth: AuthService, management: AdminService;
  let patient: string, doctor: string, administrator: string, hash: string;
  const password = 'Example123!';
  const jwt = new JwtService({ secret: 'fixture-secret-used-only-in-disposable-tests' });
  beforeAll(async () => {
    const target = new URL(url!);
    if (!target.pathname.includes('test') || !['127.0.0.1', 'localhost'].includes(target.hostname)) throw new Error('A local disposable TEST_DATABASE_URL is required');
    admin = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
    await admin.connect();
    await admin.query('CREATE EXTENSION IF NOT EXISTS vector');
    await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    schema = `security_test_${randomUUID().replace(/-/g, '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}",public`);
    for (let attempt = 0; ; attempt++) {
      try { await runMigrations(admin, { log() {} }); break; }
      catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith('Another SmartHospital') || attempt === 39) throw error;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    ds = new DataSource({ type: 'postgres', url, synchronize: false,
      entities: [...Object.values(models).filter(x => typeof x === 'function'), PasswordResetTokenEntity] as Function[],
      extra: { options: `-c search_path=${schema},public`, max: 10 } });
    await ds.initialize();
    auth = new AuthService(ds.getRepository(UserEntity), ds.getRepository(PasswordResetTokenEntity), jwt, {} as any);
    management = new AdminService(ds.getRepository(UserEntity), ds.getRepository(AppointmentSlotEntity), ds.getRepository(AppointmentEntity),
      ds.getRepository(MedicalRecordEntity), ds, {} as any);
    hash = await bcrypt.hash(password, 4);
  });
  beforeEach(async () => {
    await ds.query('TRUNCATE users CASCADE');
    const accounts = await ds.query(`INSERT INTO users(full_name,email,password_hash,role) VALUES
      ('Patient','patient@example.invalid',$1,'user'),('Doctor','doctor@example.invalid',$1,'doctor'),
      ('Administrator','admin@example.invalid',$1,'admin') RETURNING id`, [hash]);
    [patient, doctor, administrator] = accounts.map(r => r.id);
  });
  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
    if (admin) {
      if (schema) { await admin.query('SET search_path TO public'); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
      await admin.end();
    }
  });
  async function seedResetToken(userId: string, expiresAt = new Date(Date.now() + 3600_000)) {
    const raw = randomBytes(32).toString('hex');
    await ds.getRepository(PasswordResetTokenEntity).save({ userId, tokenHash: createHash('sha256').update(raw).digest('hex'), expiresAt });
    return raw;
  }

  it('omits credential fields from actual ORM reads and public directory responses', async () => {
    const row = await ds.getRepository(UserEntity).findOneByOrFail({ id: doctor });
    expect(row.passwordHash).toBeUndefined();
    expect(row.tokenVersion).toBeUndefined();
    const doctors = new DoctorsService(ds.getRepository(UserEntity), ds.getRepository(DoctorScheduleEntity), ds.getRepository(AppointmentSlotEntity), ds.getRepository(AppointmentEntity));
    const results = [await doctors.findOne(doctor), ...(await doctors.findAll())];
    for (const result of results) for (const key of ['passwordHash', 'tokenVersion', 'email', 'phone', 'preferredTimePattern']) {
      expect(result).not.toHaveProperty(key);
    }
  });

  it('issues a versioned token and revokes it on logout', async () => {
    const session = await auth.login({ email: 'patient@example.invalid', password });
    const claims = jwt.verify(session.access_token);
    expect(claims.ver).toBe(0);
    await expect(auth.validateUserById(patient, claims.ver)).resolves.toMatchObject({ id: patient });
    await auth.logout(patient);
    await expect(auth.validateUserById(patient, claims.ver)).resolves.toBeNull();
    const next = await auth.login({ email: 'patient@example.invalid', password });
    expect(jwt.verify(next.access_token).ver).toBe(1);
  });

  it('changes passwords, revokes previous sessions, and invalidates pending reset links', async () => {
    await seedResetToken(patient);
    await auth.changeMyPassword(patient, password, 'Different123!', 'Different123!');
    await expect(auth.validateUserById(patient, 0)).resolves.toBeNull();
    await expect(auth.login({ email: 'patient@example.invalid', password })).rejects.toThrow('không đúng');
    const session = await auth.login({ email: 'patient@example.invalid', password: 'Different123!' });
    expect(jwt.verify(session.access_token).ver).toBe(1);
    expect((await ds.query('SELECT id FROM password_reset_tokens WHERE user_id=$1', [patient]))).toHaveLength(0);
  });

  it('consumes one reset token only once across concurrent requests', async () => {
    const token = await seedResetToken(patient);
    const passwords = ['First123!', 'Second123!'];
    const outcomes = await Promise.allSettled(passwords.map(p => auth.resetPassword({ token, password: p, confirmPassword: p })));
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const winner = outcomes.findIndex(r => r.status === 'fulfilled');
    const row = (await ds.query('SELECT password_hash,token_version FROM users WHERE id=$1', [patient]))[0];
    expect(await bcrypt.compare(passwords[winner], row.password_hash)).toBe(true);
    expect(row.token_version).toBe(1);
    expect((await ds.query('SELECT id FROM password_reset_tokens WHERE user_id=$1', [patient]))).toHaveLength(0);
  });

  it('rejects expired reset tokens without changing credentials', async () => {
    const token = await seedResetToken(patient, new Date(Date.now() - 1000));
    await expect(auth.resetPassword({ token, password: 'Different123!', confirmPassword: 'Different123!' })).rejects.toThrow('không hợp lệ');
    const row = (await ds.query('SELECT password_hash,token_version FROM users WHERE id=$1', [patient]))[0];
    expect(row.password_hash).toBe(hash);
    expect(row.token_version).toBe(0);
  });

  it.each(['user', 'doctor', 'receptionist', 'cashier', 'admin'])('locks/unlocks %s without restoring prior tokens', async role => {
    const [account] = await ds.query(`INSERT INTO users(full_name,email,password_hash,role) VALUES('Target','target@example.invalid',$1,$2) RETURNING id`, [hash, role]);
    await management.setManagedUserLocked(administrator, account.id, true);
    await expect(auth.validateUserById(account.id, 0)).resolves.toBeNull();
    await expect(auth.login({ email: 'target@example.invalid', password })).rejects.toThrow('vô hiệu hóa');
    await management.setManagedUserLocked(administrator, account.id, false);
    await expect(auth.validateUserById(account.id, 0)).resolves.toBeNull();
    const session = await auth.login({ email: 'target@example.invalid', password });
    expect(jwt.verify(session.access_token).ver).toBe(2);
  });

  it('preserves appointment, payment and medical record rows when deactivating a patient', async () => {
    const [slot] = await ds.query(`INSERT INTO appointment_slots(doctor_id,slot_time,status) VALUES($1,'2030-01-07 09:00','booked') RETURNING id`, [doctor]);
    const [appointment] = await ds.query(`INSERT INTO appointments(user_id,doctor_id,slot_id,status) VALUES($1,$2,$3,'confirmed') RETURNING id`, [patient, doctor, slot.id]);
    await ds.query(`INSERT INTO payments(appointment_id,amount,status) VALUES($1,50000,'paid')`, [appointment.id]);
    await ds.query(`INSERT INTO medical_records(patient_id,doctor_id,appointment_id,diagnosis) VALUES($1,$2,$3,'Fixture only')`, [patient, doctor, appointment.id]);
    await management.deleteManagedUser(administrator, patient);
    expect((await ds.query('SELECT is_locked,token_version FROM users WHERE id=$1', [patient]))[0]).toMatchObject({ is_locked: true, token_version: 1 });
    expect((await ds.query('SELECT id FROM appointments WHERE id=$1', [appointment.id]))).toHaveLength(1);
    expect((await ds.query('SELECT id FROM payments WHERE appointment_id=$1', [appointment.id]))).toHaveLength(1);
    expect((await ds.query('SELECT id FROM medical_records WHERE appointment_id=$1', [appointment.id]))).toHaveLength(1);
  });

  it('keeps one active admin when two administrators try to disable each other', async () => {
    const [second] = await ds.query(`INSERT INTO users(full_name,email,password_hash,role) VALUES('Second admin','second-admin@example.invalid',$1,'admin') RETURNING id`, [hash]);
    const outcomes = await Promise.allSettled([
      management.setManagedUserLocked(administrator, second.id, true),
      management.setManagedUserLocked(second.id, administrator, true),
    ]);
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await ds.query(`SELECT COUNT(*)::int AS n FROM users WHERE role='admin' AND is_locked=false`))[0].n).toBe(1);
  });

  it('does not restore revoked tokens when saving a profile loaded before revocation', async () => {
    const repo = ds.getRepository(UserEntity);
    const stale = await repo.findOneByOrFail({ id: patient });
    await auth.logout(patient);
    stale.fullName = 'Updated fixture name';
    await repo.save(stale);
    expect((await ds.query('SELECT token_version FROM users WHERE id=$1', [patient]))[0].token_version).toBe(1);
    await expect(auth.validateUserById(patient, 0)).resolves.toBeNull();
  });
});
