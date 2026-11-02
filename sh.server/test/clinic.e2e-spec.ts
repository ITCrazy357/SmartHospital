import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { ClinicService } from '../src/clinic/clinic.service';
import type { ClinicActor } from '../src/clinic/clinic.rules';
const { runMigrations } = require('../scripts/migrate.cjs');
const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration('clinic workflow on isolated PostgreSQL', () => {
  let client: Client, db: DataSource, schema: string, clinic: ClinicService;
  let admin: ClinicActor, reception: ClinicActor, doctor: ClinicActor, otherDoctor: ClinicActor, cashier: ClinicActor, patientAccount: ClinicActor;
  let patient: string, slot: string;
  beforeAll(async () => {
    if (!new URL(url!).pathname.toLowerCase().includes('test')) throw new Error('Disposable TEST_DATABASE_URL required');
    client = new Client({ connectionString: url }); await client.connect();
    await client.query('CREATE EXTENSION IF NOT EXISTS vector'); await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    schema = `clinic_test_${randomUUID().replace(/-/g, '')}`;
    await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}",public`);
    await runMigrations(client, { log() {} });
    db = new DataSource({ type: 'postgres', url, synchronize: false, extra: { options: `-c search_path=${schema},public`, max: 10 } });
    await db.initialize(); clinic = new ClinicService(db);
  });
  beforeEach(async () => {
    await db.query('TRUNCATE users CASCADE');
    const actors = await db.query(`INSERT INTO users(full_name,email,password_hash,role) VALUES
      ('Admin','admin@example.invalid','fixture','admin'),('Reception','reception@example.invalid','fixture','receptionist'),
      ('Doctor','doctor@example.invalid','fixture','doctor'),('Other doctor','other@example.invalid','fixture','doctor'),
      ('Cashier','cashier@example.invalid','fixture','cashier'),('Patient','patient@example.invalid','fixture','user') RETURNING id,role`);
    [admin, reception, doctor, otherDoctor, cashier, patientAccount] = actors;
    const p = await clinic.createPatient(reception, { fullName: 'Fixture patient', dateOfBirth: '2000-01-01', userId: patientAccount.id }); patient = p.id;
    [slot] = (await db.query("INSERT INTO appointment_slots(doctor_id,slot_time) VALUES($1,'2030-01-07 09:00') RETURNING id", [doctor.id])).map(r => r.id);
  });
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (client) { if (schema) { await client.query('SET search_path TO public'); await client.query(`DROP SCHEMA "${schema}" CASCADE`); } await client.end(); }
  });
  const walkIn = () => clinic.createVisit(reception, { patientId: patient, doctorId: doctor.id, source: 'walk_in', scheduledAt: new Date().toISOString(), consultationFee: 100000 });

  it('checks in, starts consultation, persists final revisions and exposes only final records to patient', async () => {
    const visit = await walkIn();
    await expect(clinic.saveEncounter(doctor, visit.id, { version: 0, reason: 'Initial', diagnosis: 'Fixture' })).rejects.toThrow('Bắt đầu khám');
    await clinic.transition(reception, visit.id, { version: 1, status: 'checked_in' });
    await clinic.transition(doctor, visit.id, { version: 2, status: 'in_consultation' });
    await clinic.saveEncounter(doctor, visit.id, { version: 0, reason: 'Draft', diagnosis: 'Fixture diagnosis', vitals: { temperature: 36.8 } });
    expect((await clinic.detail(patientAccount, visit.id)).encounter).toBeNull();
    await clinic.saveEncounter(doctor, visit.id, { version: 1, reason: 'Final', diagnosis: 'Fixture diagnosis', finalize: true, followUpDate: '2030-01-10' });
    const detail = await clinic.detail(patientAccount, visit.id);
    expect(detail.visit.status).toBe('completed'); expect(detail.encounter.status).toBe('final');
    expect((await db.query('SELECT * FROM clinic_encounter_revisions')).length).toBe(2);
    expect((await clinic.followUps(patientAccount)).length).toBe(1);
  });
  it('rejects doctor cross-access, receptionist clinical editing and stale encounter saves', async () => {
    const visit = await walkIn();
    await expect(clinic.detail(otherDoctor, visit.id)).rejects.toThrow('Không phải ca khám');
    await expect(clinic.updatePatient(reception, patient, { version: 1, allergies: 'Fixture' })).rejects.toThrow('chuyên môn');
    await clinic.transition(reception, visit.id, { version: 1, status: 'checked_in' });
    await clinic.transition(doctor, visit.id, { version: 2, status: 'in_consultation' });
    const results = await Promise.allSettled([1, 2].map(() => clinic.saveEncounter(doctor, visit.id, { version: 0, reason: 'Concurrent draft', diagnosis: 'Fixture' })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.query('SELECT * FROM clinic_encounters')).length).toBe(1);
  });
  it('serializes duplicate collection, prevents overcharge and rejects financial access from patient', async () => {
    const visit = await walkIn(); const key = randomUUID();
    await expect(clinic.collect(patientAccount, visit.id, { amount: 100000, method: 'cash', idempotencyKey: key, confirmed: true })).rejects.toThrow('Không có quyền');
    const input = { amount: 60000, method: 'cash', idempotencyKey: key, confirmed: true };
    const [a, b] = await Promise.all([clinic.collect(cashier, visit.id, input), clinic.collect(cashier, visit.id, input)]);
    expect(a.id).toBe(b.id);
    await expect(clinic.collect(cashier, visit.id, { ...input, amount: 50000, idempotencyKey: randomUUID() })).rejects.toThrow('vượt phần còn');
    expect((await db.query('SELECT SUM(amount)::int AS total FROM clinic_ledger'))[0].total).toBe(60000);
  });
  it('reserves refund amounts, requires independent approval and records payout only once', async () => {
    const visit = await walkIn();
    await clinic.collect(cashier, visit.id, { amount: 100000, method: 'cash', idempotencyKey: randomUUID(), confirmed: true });
    const refund = await clinic.requestRefund(cashier, visit.id, { amount: 60000, reason: 'Fixture approved exception', idempotencyKey: randomUUID() });
    await expect(clinic.requestRefund(cashier, visit.id, { amount: 60000, reason: 'Duplicate', idempotencyKey: randomUUID() })).rejects.toThrow('vượt khoản');
    await expect(clinic.payRefund(cashier, refund.id, { confirmed: true, reference: 'fixture' })).rejects.toThrow('Chỉ hoàn sau');
    await clinic.reviewRefund(admin, refund.id, { approve: true, note: 'Checked' });
    await Promise.all([1, 2].map(() => clinic.payRefund(cashier, refund.id, { confirmed: true, reference: 'fixture' })));
    expect((await db.query("SELECT * FROM clinic_ledger WHERE kind='refund'")).length).toBe(1);
    expect((await db.query('SELECT SUM(amount)::int AS total FROM clinic_ledger'))[0].total).toBe(40000);
  });
  it('reserves a phone slot without creating an account and releases it on cancellation', async () => {
    const visit = await clinic.createVisit(reception, { patientId: patient, doctorId: doctor.id, source: 'phone', scheduledAt: '2030-01-07T02:00:00Z', slotId: slot, consultationFee: 100000 });
    expect((await db.query('SELECT status FROM appointment_slots WHERE id=$1', [slot]))[0].status).toBe('booked');
    await clinic.transition(reception, visit.id, { version: 1, status: 'cancelled', reason: 'Fixture cancelled' });
    expect((await db.query('SELECT status FROM appointment_slots WHERE id=$1', [slot]))[0].status).toBe('available');
    expect((await db.query('SELECT * FROM users')).length).toBe(6);
  });
  it('grants dependent access only through verified staff and revokes it immediately', async () => {
    const [representative] = await db.query("INSERT INTO users(full_name,email,password_hash,role) VALUES('Representative','rep@example.invalid','fixture','user') RETURNING id,role");
    const visit = await walkIn();
    await expect(clinic.detail(representative, visit.id)).rejects.toThrow('Không tìm thấy bệnh nhân');
    await expect(clinic.grantAccess(patientAccount, patient, { userId: representative.id, relationship: 'parent', confirmed: true })).rejects.toThrow('Không có quyền');
    await expect(clinic.grantAccess(reception, patient, { userId: representative.id, relationship: 'parent' })).rejects.toThrow('xác nhận');
    await clinic.grantAccess(reception, patient, { userId: representative.id, relationship: 'parent', confirmed: true });
    expect((await clinic.detail(representative, visit.id)).patient.id).toBe(patient);
    await clinic.revokeAccess(reception, patient, representative.id);
    await expect(clinic.detail(representative, visit.id)).rejects.toThrow();
  });
  it('waitlist consent never silently books or charges a patient', async () => {
    const request = await clinic.addWaitlist(patientAccount, { patientId: patient, doctorId: doctor.id, preferredDate: '2030-01-07' });
    await clinic.offerWaitlist(reception, request.id, { slotId: slot });
    await clinic.confirmWaitlist(patientAccount, request.id, { confirmed: true });
    expect((await db.query('SELECT status FROM appointment_slots WHERE id=$1', [slot]))[0].status).toBe('available');
    expect((await db.query('SELECT * FROM payments')).length).toBe(0);
    expect((await db.query('SELECT * FROM appointments')).length).toBe(0);
  });
  it('imports a paid online appointment once and publishes final encounter to patient medical records', async () => {
    const [appointment] = await db.query("INSERT INTO appointments(user_id,doctor_id,slot_id,status,deposit_amount) VALUES($1,$2,$3,'confirmed',50000) RETURNING id", [patientAccount.id, doctor.id, slot]);
    await db.query("INSERT INTO payments(appointment_id,amount,payment_type,status) VALUES($1,50000,'deposit','paid')", [appointment.id]);
    const [a, b] = await Promise.all([clinic.importAppointment(reception, appointment.id), clinic.importAppointment(reception, appointment.id)]);
    expect(a.id).toBe(b.id);
    expect((await db.query("SELECT * FROM clinic_ledger WHERE kind='deposit'")).length).toBe(1);
    await clinic.transition(reception, a.id, { version: 1, status: 'checked_in' });
    await clinic.transition(doctor, a.id, { version: 2, status: 'in_consultation' });
    await clinic.saveEncounter(doctor, a.id, { version: 0, medicalRecordVersion: 0, reason: 'Confirmed encounter', diagnosis: 'Fixture diagnosis', treatment: 'Fixture care', finalize: true });
    const [record] = await db.query('SELECT * FROM medical_records WHERE appointment_id=$1', [appointment.id]);
    expect(record.patient_id).toBe(patientAccount.id);
    expect(record.embedding_status).toBe('pending');
    expect((await db.query('SELECT * FROM medical_record_revisions WHERE record_id=$1', [record.id])).length).toBe(1);
    expect((await db.query('SELECT status FROM appointments WHERE id=$1', [appointment.id]))[0].status).toBe('completed');
    await db.query('UPDATE medical_records SET version=version+1 WHERE id=$1', [record.id]);
    await expect(clinic.saveEncounter(doctor, a.id, { version: 1, medicalRecordVersion: 1, reason: 'Stale correction', diagnosis: 'Must not overwrite', finalize: true })).rejects.toThrow('màn hình khác');
    expect((await db.query('SELECT diagnosis FROM clinic_encounters WHERE visit_id=$1', [a.id]))[0].diagnosis).toBe('Fixture diagnosis');
  });
  it('transfers credit atomically only to the same patient and rejects changed idempotency payload', async () => {
    const source = await walkIn();
    await clinic.collect(cashier, source.id, { amount: 60000, method: 'cash', idempotencyKey: randomUUID(), confirmed: true });
    await clinic.transition(reception, source.id, { version: 1, status: 'cancelled', reason: 'Reschedule fixture' });
    const target = await walkIn();
    const key = randomUUID(), input = { targetVisitId: target.id, amount: 40000, reason: 'Agreed transfer', confirmed: true, idempotencyKey: key };
    const [a, b] = await Promise.all([clinic.transfer(cashier, source.id, input), clinic.transfer(cashier, source.id, input)]);
    expect(a.id).toBe(b.id);
    await expect(clinic.transfer(cashier, source.id, { ...input, amount: 30000 })).rejects.toThrow('nội dung khác');
    expect((await db.query('SELECT SUM(amount)::int AS total FROM clinic_ledger'))[0].total).toBe(60000);
    expect(Number((await clinic.detail(cashier, target.id)).ledger[0].amount)).toBe(40000);
  });
  it('assigns operation work and keeps progress revisions under role and version checks', async () => {
    const visit = await walkIn();
    await clinic.transition(reception, visit.id, { version: 1, status: 'checked_in' });
    const task = await clinic.claimTask(reception, { kind: 'visit', targetId: visit.id });
    expect(task.assigned_to).toBe(reception.id);
    await expect(clinic.claimTask(cashier, { kind: 'visit', targetId: visit.id })).rejects.toThrow('Không có quyền');
    await clinic.updateTask(reception, task.id, { version: 1, status: 'in_progress', note: 'Asked physician to review' });
    await expect(clinic.updateTask(reception, task.id, { version: 1, status: 'resolved', note: 'Stale update' })).rejects.toThrow('Dữ liệu đã thay đổi');
    expect((await clinic.operationTasks(reception))[0].target_label).toBe('Fixture patient');
    expect((await clinic.operationTasks(cashier)).length).toBe(0);
    expect((await db.query("SELECT * FROM clinic_audit WHERE action='operation.in_progress'")).length).toBe(1);
  });
  it('intakes a late paid deposit once without booking, then resolves only after reviewed refund', async () => {
    const [appointment] = await db.query("INSERT INTO appointments(user_id,doctor_id,slot_id,status,deposit_amount) VALUES($1,$2,$3,'cancelled',50000) RETURNING id", [patientAccount.id,doctor.id,slot]);
    const [payment] = await db.query("INSERT INTO payments(appointment_id,amount,payment_type,status,reconciliation_status) VALUES($1,50000,'deposit','paid','needs_review') RETURNING id", [appointment.id]);
    await expect(clinic.reconcilePayment(reception,payment.id,{confirmed:true,note:'Checked'})).rejects.toThrow('Không có quyền');
    const [a,b] = await Promise.all([1,2].map(()=>clinic.reconcilePayment(cashier,payment.id,{confirmed:true,note:'Checked provider settlement'})));
    expect(a.id).toBe(b.id); expect(a.status).toBe('cancelled'); expect(Number(a.consultation_fee)).toBe(0);
    expect((await db.query('SELECT status FROM appointments WHERE id=$1',[appointment.id]))[0].status).toBe('cancelled');
    expect((await db.query('SELECT status FROM appointment_slots WHERE id=$1',[slot]))[0].status).toBe('available');
    expect((await db.query('SELECT * FROM clinic_payment_links')).length).toBe(1);
    expect((await db.query("SELECT * FROM clinic_ledger WHERE kind='deposit'")).length).toBe(1);
    await expect(clinic.resolveReconciliation(cashier,a.id,{confirmed:true,note:'Premature closure'})).rejects.toThrow('Còn tiền');
    const refund=await clinic.requestRefund(cashier,a.id,{amount:50000,reason:'Return expired reservation deposit',idempotencyKey:randomUUID()});
    await clinic.reviewRefund(admin,refund.id,{approve:true,note:'Verified late payment'});
    await clinic.payRefund(cashier,refund.id,{confirmed:true,reference:'bank-ref-fixture'});
    await clinic.resolveReconciliation(cashier,a.id,{confirmed:true,note:'Fully returned with bank-ref-fixture'});
    expect((await db.query('SELECT reconciliation_status FROM payments WHERE id=$1',[payment.id]))[0].reconciliation_status).toBe('resolved');
    expect((await clinic.operations(cashier)).reconciliation).toHaveLength(0);
    expect((await db.query("SELECT * FROM clinic_audit WHERE action='payment.reconciliation_resolved'")).length).toBe(1);
  });
  it('does not invent funds for an unmatched unpaid payment or change an active appointment', async () => {
    const [appointment] = await db.query("INSERT INTO appointments(user_id,doctor_id,slot_id,status,deposit_amount) VALUES($1,$2,$3,'cancelled',50000) RETURNING id", [patientAccount.id,doctor.id,slot]);
    const [payment] = await db.query("INSERT INTO payments(appointment_id,amount,payment_type,status,reconciliation_status) VALUES($1,50000,'deposit','pending','needs_review') RETURNING id", [appointment.id]);
    await expect(clinic.reconcilePayment(cashier,payment.id,{confirmed:true,note:'Amount mismatch awaiting provider'})).rejects.toThrow('Chưa có tiền cọc');
    expect((await db.query('SELECT * FROM clinic_ledger')).length).toBe(0);
    await db.query("UPDATE payments SET status='paid' WHERE id=$1",[payment.id]);
    await db.query("UPDATE appointments SET status='confirmed' WHERE id=$1",[appointment.id]);
    await expect(clinic.reconcilePayment(cashier,payment.id,{confirmed:true,note:'Do not cancel active visit'})).rejects.toThrow('lịch đã hủy');
    expect((await db.query('SELECT * FROM clinic_visits')).length).toBe(0);
  });
  it('keeps clinical details out of receptionist and cashier responses',async()=>{
    const visit=await clinic.createVisit(reception,{patientId:patient,doctorId:doctor.id,source:'walk_in',scheduledAt:new Date().toISOString(),consultationFee:50000,symptoms:'Private medical complaint'});
    await db.query("UPDATE clinic_patients SET allergies='Private allergy',medical_history='Private history' WHERE id=$1",[patient]);
    for(const actor of [reception,cashier]){
      const detail=await clinic.detail(actor,visit.id);
      expect(detail.visit.symptoms).toBeUndefined();expect(detail.patient.allergies).toBeUndefined();
      expect(detail.patient.medical_history).toBeUndefined();expect(detail.encounter).toBeNull();
      const day=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'});
      const listed=await clinic.visits(actor,day);expect(listed[0].symptoms).toBeUndefined();expect(listed[0].follow_up_date).toBeUndefined();
      if(actor.role==='receptionist')expect(listed[0].paid_amount).toBeUndefined();
      else expect(listed[0].paid_amount).toBe('0');
    }
    expect((await clinic.detail(doctor,visit.id)).visit.symptoms).toBe('Private medical complaint');
    const day=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'});
    expect((await clinic.visits(doctor,day))[0].paid_amount).toBeUndefined();
  });
  it('retries a refund proposal once and rejects changed data under the same operation key',async()=>{
    const visit=await walkIn();
    await clinic.collect(cashier,visit.id,{amount:100000,method:'cash',confirmed:true,idempotencyKey:randomUUID()});
    const body={amount:20000,reason:'Requested return',idempotencyKey:randomUUID()};
    const [a,b]=await Promise.all([clinic.requestRefund(cashier,visit.id,body),clinic.requestRefund(cashier,visit.id,body)]);
    expect(a.id).toBe(b.id);expect((await db.query('SELECT * FROM clinic_refunds')).length).toBe(1);
    await expect(clinic.requestRefund(cashier,visit.id,{...body,amount:10000})).rejects.toThrow('nội dung khác');
    await expect(clinic.requestRefund(cashier,visit.id,{...body,reason:'Changed reason'})).rejects.toThrow('nội dung khác');
    expect((await db.query("SELECT * FROM clinic_audit WHERE action='refund.requested'")).length).toBe(1);
  });
});
