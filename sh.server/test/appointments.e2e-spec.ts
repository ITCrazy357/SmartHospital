import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as models from '../src/models';
import { AppointmentEntity, AppointmentSlotEntity, PaymentEntity } from '../src/models';
import { AppointmentsService } from '../src/appointments/appointments.service';
const { runMigrations } = require('../scripts/migrate.cjs');
const url=process.env.TEST_DATABASE_URL;
const integration=url ? describe : describe.skip;

integration('appointment transactions against disposable PostgreSQL',()=>{
  let ds:DataSource,admin:Client,schema:string,service:AppointmentsService,doctor:string,p1:string,p2:string,slot1:string,slot2:string;
  const gateway={ensurePaymentLink:jest.fn(async p=>({orderCode:p.orderCode,paymentLinkId:'fixture',checkoutUrl:'https://pay.payos.vn/web/fixture'}))};
  beforeAll(async()=>{
    if(!new URL(url!).pathname.includes('test')) throw new Error('Disposable TEST_DATABASE_URL required');
    admin=new Client({connectionString:url});await admin.connect();
    await admin.query('CREATE EXTENSION IF NOT EXISTS vector');await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    schema=`apt_test_${randomUUID().replace(/-/g,'')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);await admin.query(`SET search_path TO "${schema}",public`);
    await runMigrations(admin,{log(){}});
    ds=new DataSource({type:'postgres',url,entities:Object.values(models).filter(x=>typeof x==='function') as Function[],
      synchronize:false,extra:{options:`-c search_path=${schema},public`,max:10}});
    await ds.initialize();
    service=new AppointmentsService(ds.getRepository(AppointmentEntity),ds.getRepository(PaymentEntity),ds.getRepository(AppointmentSlotEntity),ds,gateway as any,
      new ConfigService({CLIENT_APP_URL:'http://localhost:5431'}));
  });
  beforeEach(async()=>{
    await ds.query('TRUNCATE users CASCADE');gateway.ensurePaymentLink.mockClear();
    const users=await ds.query(`INSERT INTO users(full_name,email,password_hash,role) VALUES
      ('Doctor','doc@example.invalid','fixture','doctor'),('Patient1','p1@example.invalid','fixture','user'),
      ('Patient2','p2@example.invalid','fixture','user') RETURNING id`);
    [doctor,p1,p2]=users.map(u=>u.id);
    const slots=await ds.query(`INSERT INTO appointment_slots(doctor_id,slot_time) VALUES($1,'2030-01-07 09:00'),($1,'2030-01-07 10:00') RETURNING id`,[doctor]);
    [slot1,slot2]=slots.map(s=>s.id);
  });
  afterAll(async()=>{
    if(ds?.isInitialized) await ds.destroy();
    if(admin){if(schema){await admin.query('SET search_path TO public');await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}await admin.end();}
  });
  const book=(user:string,slot:string)=>service.createBooking(user,{slotId:slot},'http://localhost:5431','http://localhost:5431');
  const attachVisit=async(id:string,status='scheduled')=>{
    const registered=(await ds.query("INSERT INTO clinic_patients(user_id,full_name) VALUES($1,'Fixture patient') RETURNING id",[p1]))[0].id;
    return (await ds.query(`INSERT INTO clinic_visits(patient_id,doctor_id,appointment_id,scheduled_at,source,status,consultation_fee,created_by)
      VALUES($1,$2,$3,'2030-01-07 09:00+07','online',$4,50000,$2) RETURNING id`,[registered,doctor,id,status]))[0].id;
  };

  it('serializes competing patients so exactly one reservation wins',async()=>{
    const results=await Promise.allSettled([book(p1,slot1),book(p2,slot1)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect((await ds.query("SELECT * FROM appointments WHERE status='pending'")).length).toBe(1);
    expect((await ds.query('SELECT * FROM payments')).length).toBe(1);
  });
  it('resumes one reservation across concurrent retries without another payment',async()=>{
    const [a,b]=await Promise.all([book(p1,slot1),book(p1,slot1)]);
    expect(a.appointment.id).toBe(b.appointment.id);
    expect(a.payment.payosOrderCode).toBe(b.payment.payosOrderCode);
    expect((await ds.query('SELECT * FROM payments')).length).toBe(1);
  });
  it('records exact payment once and never reopens a completed appointment on replay',async()=>{
    const r=await book(p1,slot1),code=Number(r.payment.payosOrderCode);
    await service.markPaymentPaidByPayOSOrderCode(code,50000);
    await ds.query("UPDATE appointments SET status='completed' WHERE id=$1",[r.appointment.id]);
    await service.markPaymentPaidByPayOSOrderCode(code,50000);
    expect((await ds.query('SELECT status FROM appointments WHERE id=$1',[r.appointment.id]))[0].status).toBe('completed');
    expect((await ds.query("SELECT * FROM operation_audit WHERE action='payment.received'")).length).toBe(1);
  });
  it('routes late payment for a cancelled and reassigned slot to reconciliation',async()=>{
    const a=await book(p1,slot1);await service.cancelByPatient(p1,a.appointment.id,'Fixture cancellation');
    const b=await book(p2,slot1);
    await service.markPaymentPaidByPayOSOrderCode(Number(a.payment.payosOrderCode),50000);
    expect((await ds.query('SELECT status FROM appointments WHERE id=$1',[a.appointment.id]))[0].status).toBe('cancelled');
    expect((await ds.query('SELECT status FROM appointments WHERE id=$1',[b.appointment.id]))[0].status).toBe('pending');
    expect((await ds.query('SELECT reconciliation_status FROM payments WHERE id=$1',[a.payment.id]))[0].reconciliation_status).toBe('needs_review');
  });
  it('does not confirm a mismatched amount',async()=>{
    const r=await book(p1,slot1);await service.markPaymentPaidByPayOSOrderCode(Number(r.payment.payosOrderCode),1);
    expect((await ds.query('SELECT status FROM appointments WHERE id=$1',[r.appointment.id]))[0].status).toBe('pending');
    expect((await ds.query('SELECT status FROM payments WHERE id=$1',[r.payment.id]))[0].status).toBe('pending');
  });
  it('moves confirmed appointment and keeps its original deposit in one transaction',async()=>{
    const r=await book(p1,slot1);await service.markPaymentPaidByPayOSOrderCode(Number(r.payment.payosOrderCode),50000);
    await service.reschedule(p1,r.appointment.id,slot2,'Patient requested');
    expect((await ds.query('SELECT slot_id FROM appointments WHERE id=$1',[r.appointment.id]))[0].slot_id).toBe(slot2);
    expect((await ds.query('SELECT status FROM appointment_slots WHERE id=$1',[slot1]))[0].status).toBe('available');
    expect((await ds.query('SELECT * FROM payments WHERE appointment_id=$1',[r.appointment.id])).length).toBe(1);
  });
  it('rejects a locked doctor at booking boundary',async()=>{
    await ds.query('UPDATE users SET is_locked=true WHERE id=$1',[doctor]);
    await expect(book(p1,slot1)).rejects.toThrow('không nhận lịch');
    expect((await ds.query('SELECT * FROM appointments')).length).toBe(0);
  });
  it('rejects untrusted callback origins without reserving a slot or creating payment',async()=>{
    await expect(service.createBooking(p1,{slotId:slot1},'https://attacker.invalid/return','http://localhost:5431')).rejects.toThrow('thuộc ứng dụng');
    expect((await ds.query('SELECT id FROM appointments'))).toHaveLength(0);
    expect(gateway.ensurePaymentLink).not.toHaveBeenCalled();
  });
  it('uses payment expiry rather than mixed database wall-time to release a reservation',async()=>{
    const r=await book(p1,slot1);
    expect((await service.releaseStalePendingBookings()).cancelled).toBe(0);
    await ds.query("UPDATE payments SET expires_at=now()-interval '1 minute' WHERE id=$1",[r.payment.id]);
    expect(await service.releaseStalePendingBookings()).toEqual({cancelled:1,slotsReleased:1});
    expect((await ds.query('SELECT status FROM appointment_slots WHERE id=$1',[slot1]))[0].status).toBe('available');
  });
  it('synchronizes a scheduled clinic visit when the online appointment is rescheduled',async()=>{
    const r=await book(p1,slot1);await service.markPaymentPaidByPayOSOrderCode(Number(r.payment.payosOrderCode),50000);
    const visit=await attachVisit(r.appointment.id);
    await service.reschedule(p1,r.appointment.id,slot2,'Fixture new time');
    const clinic=(await ds.query('SELECT scheduled_at,version,status FROM clinic_visits WHERE id=$1',[visit]))[0];
    const slot=(await ds.getRepository(AppointmentSlotEntity).findOneByOrFail({id:slot2}));
    expect(new Date(clinic.scheduled_at).getTime()).toBe(new Date(slot.slotTime).getTime());
    expect(clinic).toMatchObject({version:2,status:'scheduled'});
  });
  it('cancels an imported scheduled visit but refuses to cancel an ongoing consultation',async()=>{
    const r=await book(p1,slot1);await service.markPaymentPaidByPayOSOrderCode(Number(r.payment.payosOrderCode),50000);
    const visit=await attachVisit(r.appointment.id,'in_consultation');
    await expect(service.cancelByPatient(p1,r.appointment.id,'Fixture')).rejects.toThrow('đang khám');
    expect((await ds.query('SELECT status FROM appointments WHERE id=$1',[r.appointment.id]))[0].status).toBe('confirmed');
    await ds.query("UPDATE clinic_visits SET status='scheduled' WHERE id=$1",[visit]);
    await service.cancelByPatient(p1,r.appointment.id,'Fixture cancellation');
    expect((await ds.query('SELECT status,version FROM clinic_visits WHERE id=$1',[visit]))[0]).toMatchObject({status:'cancelled',version:2});
  });
  it('does not re-open already resolved reconciliation on an exact webhook replay',async()=>{
    const r=await book(p1,slot1);await service.cancelByPatient(p1,r.appointment.id,'Fixture');
    await service.markPaymentPaidByPayOSOrderCode(Number(r.payment.payosOrderCode),50000);
    await ds.query("UPDATE payments SET reconciliation_status='resolved',reconciliation_reason='Fixture reviewed' WHERE id=$1",[r.payment.id]);
    await service.markPaymentPaidByPayOSOrderCode(Number(r.payment.payosOrderCode),50000);
    expect((await ds.query('SELECT reconciliation_status,reconciliation_reason FROM payments WHERE id=$1',[r.payment.id]))[0])
      .toEqual({reconciliation_status:'resolved',reconciliation_reason:'Fixture reviewed'});
  });
  it('keeps past slots referenced by phone visits when removing orphan available slots',async()=>{
    const past=(await ds.query("INSERT INTO appointment_slots(doctor_id,slot_time,status) VALUES($1,'2020-01-06 09:00','available') RETURNING id",[doctor]))[0].id;
    const registered=(await ds.query("INSERT INTO clinic_patients(full_name) VALUES('Phone fixture') RETURNING id"))[0].id;
    await ds.query(`INSERT INTO clinic_visits(patient_id,doctor_id,slot_id,scheduled_at,source,status,consultation_fee,created_by)
      VALUES($1,$2,$3,'2020-01-06 09:00+07','phone','cancelled',50000,$2)`,[registered,doctor,past]);
    await expect(service.purgeOrphanPastAvailableSlots()).resolves.toBe(0);
    expect((await ds.query('SELECT id FROM appointment_slots WHERE id=$1',[past]))).toHaveLength(1);
  });
});
