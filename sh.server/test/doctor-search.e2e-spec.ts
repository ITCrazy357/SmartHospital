import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import * as models from '../src/models';
import { UserEntity, AppointmentEntity, AppointmentSlotEntity, DoctorScheduleEntity, DoctorChatSessionEntity, DoctorChatMessageEntity } from '../src/models';
import { DoctorsService } from '../src/doctors/doctors.service';
import { DoctorChatSessionsService } from '../src/doctor-ai/doctor-chat-sessions.service';
const { runMigrations } = require('../scripts/migrate.cjs');
const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration('paginated public doctor directory and bounded chat previews', () => {
  let ds: DataSource, admin: Client, schema: string, service: DoctorsService;
  let department: string, otherDepartment: string, doctors: string[];
  beforeAll(async () => {
    if (!new URL(url!).pathname.includes('test')) throw new Error('Disposable TEST_DATABASE_URL required');
    admin = new Client({ connectionString: url }); await admin.connect();
    await admin.query('CREATE EXTENSION IF NOT EXISTS vector'); await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    schema = `directory_test_${randomUUID().replace(/-/g, '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`); await admin.query(`SET search_path TO "${schema}",public`);
    await runMigrations(admin, { log() {} });
    ds = new DataSource({ type: 'postgres', url, entities: Object.values(models).filter(x => typeof x === 'function') as Function[],
      synchronize: false, extra: { options: `-c search_path=${schema},public`, max: 5 } });
    await ds.initialize();
    service = new DoctorsService(ds.getRepository(UserEntity), ds.getRepository(DoctorScheduleEntity), ds.getRepository(AppointmentSlotEntity), ds.getRepository(AppointmentEntity));
  });
  beforeEach(async () => {
    await ds.query('TRUNCATE users,departments CASCADE');
    const rows = await ds.query(`INSERT INTO departments(id,name) VALUES(gen_random_uuid(),'Tim mạch'),(gen_random_uuid(),'Nhi khoa') RETURNING id`);
    [department, otherDepartment] = rows.map(x => x.id);
    const people = await ds.query(`INSERT INTO users(full_name,email,password_hash,role,department_id,experience_years,is_locked) VALUES
      ('Anh','anh@example.invalid','fixture-hash','doctor',$1,5,false),
      ('Bình','binh@example.invalid','fixture-hash','doctor',$1,6,false),
      ('Chi','chi@example.invalid','fixture-hash','doctor',$2,11,false),
      ('Locked','locked@example.invalid','fixture-hash','doctor',$1,20,true),
      ('Patient','patient@example.invalid','fixture-hash','user',NULL,NULL,false) RETURNING id`, [department, otherDepartment]);
    doctors = people.map(x => x.id);
  });
  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
    if (admin) { if (schema) { await admin.query('SET search_path TO public'); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } await admin.end(); }
  });

  it('paginates on the server with stable total and public DTO allowlist', async () => {
    const one = await service.search({ page: '1', pageSize: '2' });
    const two = await service.search({ page: '2', pageSize: '2' });
    expect(one.total).toBe(3); expect(one.items).toHaveLength(2); expect(two.items).toHaveLength(1);
    expect(new Set([...one.items, ...two.items].map(x => x.id)).size).toBe(3);
    expect(one.departmentCounts).toEqual({ [department]: 2, [otherDepartment]: 1 });
    for (const item of [...one.items, ...two.items]) {
      expect(item).not.toHaveProperty('passwordHash'); expect(item).not.toHaveProperty('email'); expect(item).not.toHaveProperty('phone');
    }
  });
  it('combines department, literal name and exact experience bucket boundaries', async () => {
    expect((await service.search({ experience: '1-5', departmentId: department })).items.map(x => x.fullName)).toEqual(['Anh']);
    expect((await service.search({ experience: '5-10' })).items.map(x => x.fullName)).toEqual(['Bình']);
    expect((await service.search({ experience: '10+' })).items.map(x => x.fullName)).toEqual(['Chi']);
    expect((await service.search({ q: 'BS. Bình', departmentId: department })).total).toBe(1);
    expect((await service.search({ q: 'Nhi khoa' })).items.map(x => x.fullName)).toEqual(['Chi']);
    expect((await service.search({ q: '%' })).total).toBe(0);
    expect((await service.search({ q: "%' OR true --" })).total).toBe(0);
  });
  it('rejects malformed pagination, dates and list filters before querying', async () => {
    for (const input of [{ page: '0' }, { pageSize: '500' }, { departmentId: 'fake' }, { experience: '0-99' }, { availability: 'yesterday' }, { q: ['a'] }])
      await expect(service.search(input)).rejects.toThrow();
  });
  it('never duplicates a doctor with multiple slots and excludes booked, leave and closed days', async () => {
    // PostgreSQL owns both clock and VN calendar boundaries. Pick the next
    // working day so weekday CHECK remains valid on weekend test runs.
    const [clock] = await ds.query(`SELECT to_char(d,'YYYY-MM-DD') AS day,
      CASE WHEN d::date=(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date THEN 'today'
      WHEN d::date=(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date+1 THEN 'tomorrow' ELSE 'week' END AS filter,
      date_trunc('week',d)=date_trunc('week',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AS same_week
      FROM generate_series(date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh')+interval '1 day',
        date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh')+interval '7 days',interval '1 day') d
      WHERE EXTRACT(ISODOW FROM d)<=5 ORDER BY d LIMIT 1`);
    await ds.query(`INSERT INTO appointment_slots(doctor_id,slot_time,status) VALUES
      ($1,$4::date+time '09:00','available'),($1,$4::date+time '10:00','available'),
      ($2,$4::date+time '09:00','booked'),($3,$4::date+time '09:00','available')`, [doctors[0], doctors[1], doctors[2], clock.day]);
    if (clock.filter === 'week' && !clock.same_week) {
      // No positive slot belongs to this calendar week on a weekend, but future
      // next-week slots must not accidentally satisfy the current-week filter.
      expect((await service.search({ availability: 'week' })).total).toBe(0);
      return;
    }
    expect((await service.search({ availability: clock.filter })).total).toBe(2);
    await ds.query(`INSERT INTO doctor_leave_requests(doctor_id,start_date,end_date,status) VALUES($1,$2,$2,'approved')`, [doctors[2], clock.day]);
    const available = await service.search({ availability: clock.filter });
    expect(available.items.map(x => x.fullName)).toEqual(['Anh']); expect(available.total).toBe(1);
    await ds.query(`INSERT INTO doctor_schedule_exceptions(doctor_id,work_date,closed,reason,updated_by) VALUES($1,$2,true,'Fixture closure',$1)`, [doctors[0], clock.day]);
    expect((await service.search({ availability: clock.filter })).total).toBe(0);
  });
  it('selects only the latest user preview for each visible doctor session', async () => {
    const own = await ds.query(`INSERT INTO doctor_chat_sessions(doctor_id,title) VALUES($1,'Own A'),($1,'Own B'),($2,'Other') RETURNING id`, [doctors[0], doctors[1]]);
    await ds.query(`INSERT INTO doctor_chat_messages(session_id,role,content,created_at) VALUES
      ($1,'user','old',now()-interval '2 hours'),($1,'user','latest',now()-interval '1 hour'),
      ($1,'assistant','answer',now()),($2,'user','second',now()),($3,'user','private other doctor',now())`, own.map(x => x.id));
    const sessions = new DoctorChatSessionsService(ds.getRepository(DoctorChatSessionEntity), ds.getRepository(DoctorChatMessageEntity));
    const list = await sessions.list(doctors[0]);
    expect(list).toHaveLength(2);
    expect(list.find(x => x.id === own[0].id)?.lastUserMessage).toBe('latest');
    expect(list.find(x => x.id === own[0].id)?.messageCount).toBe(3);
    expect(list.map(x => x.lastUserMessage)).not.toContain('private other doctor');
  });
});
