import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { AppointmentRemindersService } from '../src/appointments/appointment-reminders.service';
const { runMigrations } = require('../scripts/migrate.cjs');
const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration('reminder windows and worker leases on disposable PostgreSQL', () => {
  let client: Client, schema: string, appointment: string, service: AppointmentRemindersService;
  const send = jest.fn();
  const mail = { isConfigured: () => true, sendAppointmentReminderEmail: send };
  beforeAll(async () => {
    const target = new URL(url!);
    if (!target.pathname.toLowerCase().includes('test')) throw new Error('Disposable TEST_DATABASE_URL required');
    client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 }); await client.connect();
    await client.query('CREATE EXTENSION IF NOT EXISTS vector'); await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    schema = `reminder_test_${randomUUID().replace(/-/g, '')}`;
    await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}",public`);
    await runMigrations(client, { log() {} });
    // Exercise UTC-hosted PostgreSQL while appointment wall times remain Vietnamese.
    await client.query("SET TIME ZONE 'UTC'");
    // Isolate reminder timing from the separately tested weekday booking policy,
    // allowing the same 30-minute fixture to run on weekend CI jobs.
    await client.query('ALTER TABLE appointment_slots DROP CONSTRAINT appointment_slots_slot_weekday_only');
    service = new AppointmentRemindersService({ query: async (sql: string, args?: unknown[]) => (await client.query(sql, args)).rows } as any, mail as any);
  });
  beforeEach(async () => {
    await client.query('TRUNCATE users CASCADE'); send.mockReset(); send.mockResolvedValue(undefined);
    const accounts = (await client.query(`INSERT INTO users(full_name,email,password_hash,role) VALUES
      ('Doctor','doctor@example.invalid','fixture','doctor'),('Patient','patient@example.invalid','fixture','user') RETURNING id,role`)).rows;
    const doctor = accounts.find(a => a.role === 'doctor').id, patient = accounts.find(a => a.role === 'user').id;
    const slot = (await client.query(`INSERT INTO appointment_slots(doctor_id,slot_time,status)
      VALUES($1,(now()+interval '30 minutes') AT TIME ZONE 'Asia/Ho_Chi_Minh','booked') RETURNING id`, [doctor])).rows[0].id;
    appointment = (await client.query(`INSERT INTO appointments(user_id,doctor_id,slot_id,status)
      VALUES($1,$2,$3,'confirmed') RETURNING id`, [patient, doctor, slot])).rows[0].id;
  });
  afterAll(async () => {
    if (client) {
      await client.query('SET search_path TO public');
      if (schema) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
      await client.end();
    }
  });

  it('sends the one-hour reminder for VN wall-time slots on a UTC database', async () => {
    const result = await service.runRemindersOnce();
    expect(result.h1Sent).toBe(1); expect(result.h24Sent).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    const row = (await client.query("SELECT status,attempts FROM appointment_reminders WHERE appointment_id=$1 AND kind='h1'", [appointment])).rows[0];
    expect(row).toEqual({ status: 'sent', attempts: 1 });
    await service.runRemindersOnce(); expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not take a live lease but reclaims an expired worker reservation', async () => {
    await client.query(`INSERT INTO appointment_reminders(appointment_id,kind,status,attempts,locked_until)
      VALUES($1,'h1','processing',1,now()+interval '5 minutes')`, [appointment]);
    expect((await service.runRemindersOnce()).h1Sent).toBe(0); expect(send).not.toHaveBeenCalled();
    await client.query("UPDATE appointment_reminders SET locked_until=now()-interval '1 second' WHERE appointment_id=$1", [appointment]);
    expect((await service.runRemindersOnce()).h1Sent).toBe(1);
    expect((await client.query('SELECT status,attempts FROM appointment_reminders WHERE appointment_id=$1', [appointment])).rows[0]).toEqual({ status: 'sent', attempts: 2 });
  });

  it('keeps failed provider delivery retryable and records success only after retry', async () => {
    send.mockRejectedValueOnce(new Error('fixture provider failure'));
    expect((await service.runRemindersOnce()).h1Failed).toBe(1);
    const row = (await client.query('SELECT status,attempts,last_error FROM appointment_reminders WHERE appointment_id=$1', [appointment])).rows[0];
    expect(row).toEqual({ status: 'failed', attempts: 1, last_error: 'delivery_failed' });
    expect((await service.runRemindersOnce()).h1Sent).toBe(0);
    await client.query("UPDATE appointment_reminders SET next_attempt_at=now()-interval '1 second' WHERE appointment_id=$1", [appointment]);
    expect((await service.runRemindersOnce()).h1Sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
