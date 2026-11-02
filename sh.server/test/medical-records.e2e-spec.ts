import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import * as models from '../src/models';
import { UserEntity, AppointmentEntity, MedicalRecordEntity } from '../src/models';
import { MedicalRecordsService } from '../src/medical-records/medical-records.service';
const { runMigrations } = require('../scripts/migrate.cjs');
const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration('medical records concurrency and rollback on PostgreSQL', () => {
  let client: Client, db: DataSource, schema: string, service: MedicalRecordsService;
  let doctor: string, patient: string, appointment: string;
  beforeAll(async () => {
    if (!new URL(url!).pathname.toLowerCase().includes('test')) throw new Error('Disposable TEST_DATABASE_URL required.');
    client = new Client({ connectionString: url }); await client.connect();
    await client.query('CREATE EXTENSION IF NOT EXISTS vector'); await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    schema = `medical_test_${randomUUID().replace(/-/g, '')}`;
    await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}",public`);
    await runMigrations(client, { log() {} });
    db = new DataSource({ type: 'postgres', url, schema, entities: Object.values(models).filter(value => typeof value === 'function') as any, synchronize: false, extra: { options: `-c search_path=${schema},public`, max: 5 } });
    await db.initialize();
    service = new MedicalRecordsService(db.getRepository(MedicalRecordEntity), db.getRepository(AppointmentEntity), db.getRepository(UserEntity), db, {} as any, { embedRecord: async () => false } as any);
  });
  beforeEach(async () => {
    await db.query('TRUNCATE users CASCADE');
    const users = await db.query("INSERT INTO users(full_name,email,password_hash,role) VALUES ('Doctor','doctor@example.invalid','fixture','doctor'),('Patient','patient@example.invalid','fixture','user') RETURNING id,role");
    doctor = users.find((u: any) => u.role === 'doctor').id; patient = users.find((u: any) => u.role === 'user').id;
    const slot = (await db.query("INSERT INTO appointment_slots(doctor_id,slot_time,status) VALUES($1,'2020-01-06 09:00','booked') RETURNING id", [doctor]))[0].id;
    appointment = (await db.query("INSERT INTO appointments(user_id,doctor_id,slot_id,status) VALUES($1,$2,$3,'confirmed') RETURNING id", [patient,doctor,slot]))[0].id;
    const registered = (await db.query("INSERT INTO clinic_patients(user_id,full_name) VALUES($1,'Fixture patient') RETURNING id", [patient]))[0].id;
    await db.query("INSERT INTO clinic_visits(patient_id,doctor_id,appointment_id,slot_id,scheduled_at,source,status,consultation_fee,created_by) VALUES($1,$2,$3,$4,'2020-01-06 09:00+07','online','checked_in',50000,$2)", [registered,doctor,appointment,slot]);
  });
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (client) { await client.query('SET search_path TO public'); if (schema) await client.query(`DROP SCHEMA "${schema}" CASCADE`); await client.end(); }
  });

  it('two concurrent creates save only one record and one completion', async () => {
    const result = await Promise.allSettled([1,2].map(() => service.createFromAppointment(doctor, { appointmentId: appointment, diagnosis: 'Fixture only' })));
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.query('SELECT count(*)::int AS count FROM medical_records WHERE appointment_id=$1', [appointment]))[0].count).toBe(1);
    expect((await db.query('SELECT status FROM appointments WHERE id=$1', [appointment]))[0].status).toBe('completed');
  });

  it('does not turn a no-show into an examined patient', async () => {
    await db.query("UPDATE clinic_visits SET status='no_show' WHERE appointment_id=$1", [appointment]);
    await expect(service.createFromAppointment(doctor, { appointmentId: appointment, diagnosis: 'Fixture only' })).rejects.toThrow('chưa được tiếp đón');
    expect((await db.query('SELECT count(*)::int AS count FROM medical_records'))[0].count).toBe(0);
  });

  it('rolls back record, appointment and visit when revision persistence fails', async () => {
    await db.query("CREATE FUNCTION reject_revision_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture revision failure'; END $$");
    await db.query('CREATE TRIGGER reject_revision_fixture BEFORE INSERT ON medical_record_revisions FOR EACH ROW EXECUTE FUNCTION reject_revision_fixture()');
    try {
      await expect(service.createFromAppointment(doctor, { appointmentId: appointment, diagnosis: 'Fixture only' })).rejects.toThrow('fixture revision failure');
      expect((await db.query('SELECT count(*)::int AS count FROM medical_records'))[0].count).toBe(0);
      expect((await db.query('SELECT status FROM appointments WHERE id=$1', [appointment]))[0].status).toBe('confirmed');
      expect((await db.query('SELECT status FROM clinic_visits WHERE appointment_id=$1', [appointment]))[0].status).toBe('checked_in');
    } finally {
      await db.query('DROP TRIGGER reject_revision_fixture ON medical_record_revisions');
      await db.query('DROP FUNCTION reject_revision_fixture()');
    }
  });

  it('serializes edits with optimistic version and preserves revisions', async () => {
    const created = await service.createFromAppointment(doctor, { appointmentId: appointment, diagnosis: 'Fixture version one' });
    const result = await Promise.allSettled(['A','B'].map(suffix => service.updateMyRecord(doctor, created.record.id, { version: 1, reason: `Fixture correction ${suffix}`, diagnosis: `Fixture version two ${suffix}` })));
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.query('SELECT version,embedding_status FROM medical_records WHERE id=$1', [created.record.id]))[0]).toEqual({ version: 2, embedding_status: 'pending' });
    expect((await db.query('SELECT version FROM medical_record_revisions WHERE record_id=$1 ORDER BY version', [created.record.id])).map((r: any) => r.version)).toEqual([1,2]);
  });

  it('keeps revision history scoped to the treating doctor', async () => {
    const created = await service.createFromAppointment(doctor, { appointmentId: appointment, diagnosis: 'Fixture first version' });
    await service.updateMyRecord(doctor, created.record.id, { version: 1, reason: 'Fixture correction', diagnosis: 'Fixture second version' });
    const revisions = await service.revisionsForDoctor(doctor, created.record.id);
    expect(revisions.map((r: any) => r.version)).toEqual([2, 1]);
    expect(revisions[0]).toMatchObject({ reason: 'Fixture correction', actor_name: 'Doctor', snapshot: { diagnosis: 'Fixture second version' } });
    await expect(service.revisionsForDoctor(patient, created.record.id)).rejects.toThrow('không thuộc bạn');
  });

  it('requires the structured editor after a linked encounter has been finalized', async () => {
    const created = await service.createFromAppointment(doctor, { appointmentId: appointment, diagnosis: 'Published fixture' });
    const visit = (await db.query('SELECT id FROM clinic_visits WHERE appointment_id=$1', [appointment]))[0];
    await db.query("INSERT INTO clinic_encounters(visit_id,status,diagnosis,updated_by) VALUES($1,'final','Published fixture',$2)", [visit.id, doctor]);
    await expect(service.updateMyRecord(doctor, created.record.id, { version: 1, reason: 'Legacy editor request', diagnosis: 'Unsynchronized change' })).rejects.toThrow('Hồ sơ có cấu trúc');
    expect((await db.query('SELECT diagnosis,version FROM medical_records WHERE id=$1', [created.record.id]))[0]).toEqual({ diagnosis: 'Published fixture', version: 1 });
    expect((await db.query('SELECT version FROM medical_record_revisions WHERE record_id=$1', [created.record.id]))).toHaveLength(1);
  });
});
