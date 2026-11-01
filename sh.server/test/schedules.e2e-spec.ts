import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as models from '../src/models';
import { AppointmentEntity, AppointmentSlotEntity, DoctorLeaveRequestEntity, PaymentEntity, UserEntity } from '../src/models';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { SchedulesService } from '../src/schedules/schedules.service';
import { LeaveRequestsService } from '../src/leave-requests/leave-requests.service';
import { addDays, todayVn } from '../src/schedules/schedule.rules';
import { AdminService } from '../src/admin/admin.service';
import { MedicalRecordEntity } from '../src/models';
const { runMigrations } = require('../scripts/migrate.cjs');
const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration('schedule horizon and leave transactions on disposable PostgreSQL', () => {
  let admin: Client, ds: DataSource, schema: string, schedules: SchedulesService, leaves: LeaveRequestsService, appointments: AppointmentsService;
  let doctor: string, adminId: string, patient: string;
  const gateway = { ensurePaymentLink: jest.fn(async p => ({ orderCode: p.orderCode, paymentLinkId: 'fixture', checkoutUrl: 'https://pay.payos.vn/web/fixture' })) };
  const nextWeekday = (weekday: number) => {
    let date = addDays(todayVn(), 1);
    while (new Date(`${date}T12:00:00Z`).getUTCDay() !== weekday) date = addDays(date, 1);
    return date;
  };
  beforeAll(async () => {
    const target = new URL(url!);
    if (!target.pathname.includes('test') || !['127.0.0.1', 'localhost'].includes(target.hostname)) throw new Error('A local disposable TEST_DATABASE_URL is required');
    admin = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
    await admin.connect();
    await admin.query('CREATE EXTENSION IF NOT EXISTS vector');
    await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    schema = `schedule_test_${randomUUID().replace(/-/g, '')}`;
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
      entities: Object.values(models).filter(x => typeof x === 'function') as Function[],
      extra: { options: `-c search_path=${schema},public`, max: 10 } });
    await ds.initialize();
    schedules = new SchedulesService(ds);
    leaves = new LeaveRequestsService(ds.getRepository(DoctorLeaveRequestEntity), ds.getRepository(AppointmentSlotEntity), ds.getRepository(UserEntity), ds);
    appointments = new AppointmentsService(ds.getRepository(AppointmentEntity), ds.getRepository(PaymentEntity), ds.getRepository(AppointmentSlotEntity), ds, gateway as any,
      new ConfigService({ CLIENT_APP_URL: 'http://localhost:5431' }));
  });
  beforeEach(async () => {
    await ds.query('TRUNCATE users CASCADE');
    const users = await ds.query(`INSERT INTO users(full_name,email,password_hash,role) VALUES
      ('Doctor','doctor@example.invalid','fixture','doctor'),('Admin','admin@example.invalid','fixture','admin'),
      ('Patient','patient@example.invalid','fixture','user') RETURNING id`);
    [doctor, adminId, patient] = users.map(u => u.id);
    gateway.ensurePaymentLink.mockClear();
  });
  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
    if (admin) {
      if (schema) { await admin.query('SET search_path TO public'); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
      await admin.end();
    }
  });
  const book = (slotId: string) => appointments.createBooking(patient, { slotId }, 'http://localhost:5431', 'http://localhost:5431');
  const slotFor = async (date: string) => (await ds.query(`SELECT id FROM appointment_slots WHERE doctor_id=$1 AND slot_time::date=$2::date AND status='available' ORDER BY slot_time LIMIT 1`, [doctor, date]))[0].id as string;

  it('extends beyond 14 days and remains idempotent on repeated generation', async () => {
    await schedules.initializeDoctor(doctor);
    const before = (await ds.query('SELECT COUNT(*)::int AS n FROM appointment_slots'))[0].n;
    expect(before).toBeGreaterThan(0);
    expect((await ds.query(`SELECT COUNT(*)::int AS n FROM appointment_slots WHERE slot_time::date > $1::date`, [addDays(todayVn(), 14)]))[0].n).toBeGreaterThan(0);
    await schedules.generateForDoctor(doctor);
    expect((await ds.query('SELECT COUNT(*)::int AS n FROM appointment_slots'))[0].n).toBe(before);
    expect((await ds.query(`SELECT COUNT(*)::int AS n FROM appointment_slots WHERE EXTRACT(ISODOW FROM slot_time) IN (6,7)`))[0].n).toBe(0);
  });

  it('prevents a duration change on a weekday with a booked patient', async () => {
    await schedules.initializeDoctor(doctor);
    const date = nextWeekday(1), slotId = await slotFor(date);
    const booked = await book(slotId);
    const plan = await schedules.plan(doctor);
    const rules = plan.rules.map(r => r.weekday === 1 && r.startTime === '08:00' ? { ...r, intervalMinutes: 30 } : r);
    const preview = await schedules.preview(doctor, rules);
    expect(preview.bookedConflicts).toBe(1);
    await expect(schedules.saveRules(doctor, adminId, { rules, expectedVersion: plan.version, confirm: true })).rejects.toThrow('còn lịch đã đặt');
    expect((await schedules.plan(doctor)).rules).toEqual(plan.rules);
    expect((await ds.query('SELECT slot_id FROM appointments WHERE id=$1', [booked.appointment.id]))[0].slot_id).toBe(slotId);
  });

  it('previews/closes/reopens a date without generation reopening a closed exception', async () => {
    await schedules.initializeDoctor(doctor);
    const workDate = nextWeekday(2), body = { workDate, closed: true, reason: 'Fixture holiday' };
    const preview = await schedules.previewException(doctor, body);
    expect(preview.slotsToClose).toBeGreaterThan(0);
    expect(preview.bookedConflicts).toBe(0);
    let plan = await schedules.setException(doctor, adminId, { ...body, expectedVersion: preview.version, confirm: true });
    await schedules.generateForDoctor(doctor);
    expect((await ds.query(`SELECT COUNT(*)::int AS n FROM appointment_slots WHERE doctor_id=$1 AND slot_time::date=$2::date AND status='available'`, [doctor, workDate]))[0].n).toBe(0);
    plan = await schedules.setException(doctor, adminId, { ...body, closed: false, expectedVersion: plan.version, confirm: true });
    expect((await ds.query(`SELECT COUNT(*)::int AS n FROM appointment_slots WHERE doctor_id=$1 AND slot_time::date=$2::date AND status='available'`, [doctor, workDate]))[0].n).toBeGreaterThan(0);
  });

  it('keeps approved leave closed when the horizon job runs again', async () => {
    await schedules.initializeDoctor(doctor);
    const date = nextWeekday(3);
    const leave = await leaves.createForDoctor(doctor, { startDate: date, endDate: date, reason: 'Fixture leave' });
    await leaves.approve(leave.id, adminId);
    await schedules.generateForDoctor(doctor);
    expect((await ds.query(`SELECT COUNT(*)::int AS n FROM appointment_slots WHERE doctor_id=$1 AND slot_time::date=$2::date AND status='available'`, [doctor, date]))[0].n).toBe(0);
    expect((await ds.query('SELECT status FROM doctor_leave_requests WHERE id=$1', [leave.id]))[0].status).toBe('approved');
  });

  it('serializes booking against leave approval so both cannot win', async () => {
    await schedules.initializeDoctor(doctor);
    const date = nextWeekday(4), slotId = await slotFor(date);
    const leave = await leaves.createForDoctor(doctor, { startDate: date, endDate: date });
    const outcomes = await Promise.allSettled([book(slotId), leaves.approve(leave.id, adminId)]);
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const leaveStatus = (await ds.query('SELECT status FROM doctor_leave_requests WHERE id=$1', [leave.id]))[0].status;
    const count = (await ds.query('SELECT COUNT(*)::int AS n FROM appointments WHERE slot_id=$1', [slotId]))[0].n;
    expect(leaveStatus === 'approved' ? count === 0 : count === 1).toBe(true);
  });

  it('serializes competing approve/reject decisions', async () => {
    await schedules.initializeDoctor(doctor);
    const date = nextWeekday(5);
    const leave = await leaves.createForDoctor(doctor, { startDate: date, endDate: date });
    const outcomes = await Promise.allSettled([leaves.approve(leave.id, adminId), leaves.reject(leave.id, adminId)]);
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('rejects a stale preview after another administrator edits the rules', async () => {
    await schedules.initializeDoctor(doctor);
    const before = await schedules.plan(doctor);
    const rules = before.rules.map(r => r.weekday === 1 && r.startTime === '08:00' ? { ...r, startTime: '09:00' } : r);
    await schedules.saveRules(doctor, adminId, { rules, expectedVersion: before.version, confirm: true });
    await expect(schedules.saveRules(doctor, adminId, { rules: before.rules, expectedVersion: before.version, confirm: true })).rejects.toThrow('Lịch đã thay đổi');
    expect((await schedules.plan(doctor)).rules).toEqual(rules);
  });

  it('rolls account creation back if initial schedule generation fails', async () => {
    const service = new AdminService(ds.getRepository(UserEntity), ds.getRepository(AppointmentSlotEntity), ds.getRepository(AppointmentEntity),
      ds.getRepository(MedicalRecordEntity), ds, {} as any, { initializeDoctor: async () => { throw new Error('Fixture generation failure'); } } as any);
    await expect(service.createDoctor({ email: 'new-doctor@example.invalid', password: 'Example123!', fullName: 'New fixture doctor' })).rejects.toThrow('Fixture generation failure');
    expect((await ds.query(`SELECT id FROM users WHERE email='new-doctor@example.invalid'`))).toHaveLength(0);
  });
});
