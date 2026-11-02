import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';
import { lockDoctor } from '../common/doctor-lock';
import { ClinicActor, STAFF_ROLES, assertVersion, assertVisitTransition, isoDate, money, requireRole, text, uuid, version, vitals } from './clinic.rules';

type Db = Pick<EntityManager, 'query'>;
type Input = Record<string, unknown>;

@Injectable()
export class ClinicService {
  constructor(private readonly db: DataSource) {}

  private async audit(db: Db, actor: ClinicActor, action: string, targetId: string, details: Input = {}) {
    await db.query('INSERT INTO clinic_audit(actor_id,action,target_id,details) VALUES ($1,$2,$3,$4::jsonb)', [actor.id, action, targetId, JSON.stringify(details)]);
  }

  private async canReadPatient(db: Db, actor: ClinicActor, patientId: string) {
    const rows = await db.query(`SELECT p.id FROM clinic_patients p WHERE p.id=$1 AND (
      $2::text IN ('admin','receptionist','cashier') OR p.user_id=$3 OR
      EXISTS(SELECT 1 FROM clinic_patient_access x WHERE x.patient_id=p.id AND x.user_id=$3) OR
      ($2='doctor' AND (EXISTS(SELECT 1 FROM clinic_visits v WHERE v.patient_id=p.id AND v.doctor_id=$3) OR
       EXISTS(SELECT 1 FROM appointments a WHERE a.user_id=p.user_id AND a.doctor_id=$3))))`, [patientId, actor.role, actor.id]);
    if (!rows.length) throw new NotFoundException('Không tìm thấy bệnh nhân hoặc không có quyền truy cập');
  }

  private async activeDoctor(db: Db, doctorId: string) {
    const rows = await db.query("SELECT id FROM users WHERE id=$1 AND role='doctor' AND is_locked=false FOR SHARE", [doctorId]);
    if (!rows.length) throw new BadRequestException('Bác sĩ không khả dụng');
  }

  async patients(actor: ClinicActor, search = '', page = 1) {
    const q = text(search, 'Tìm kiếm', 100) ?? '';
    const offset = (Math.max(1, Math.min(10000, Number(page) || 1)) - 1) * 30;
    const clinical = actor.role === 'doctor' || actor.role === 'admin' || actor.role === 'user';
    return this.db.query(`SELECT p.id,p.patient_code,p.user_id,p.full_name,p.date_of_birth,p.sex,p.phone,p.address,p.version,
      ${clinical ? 'p.allergies,p.medical_history,' : ''} p.created_at,COUNT(*) OVER()::int AS total
      FROM clinic_patients p WHERE (p.full_name ILIKE $1 OR p.patient_code ILIKE $1 OR p.phone ILIKE $1)
      AND ($2::text IN ('admin','receptionist','cashier') OR p.user_id=$3 OR
       EXISTS(SELECT 1 FROM clinic_patient_access x WHERE x.patient_id=p.id AND x.user_id=$3) OR
       ($2='doctor' AND (EXISTS(SELECT 1 FROM clinic_visits v WHERE v.patient_id=p.id AND v.doctor_id=$3) OR
       EXISTS(SELECT 1 FROM appointments a WHERE a.user_id=p.user_id AND a.doctor_id=$3))))
      ORDER BY p.full_name,p.id LIMIT 30 OFFSET $4`, [`%${q}%`, actor.role, actor.id, offset]);
  }

  async createPatient(actor: ClinicActor, body: Input) {
    requireRole(actor, ['admin', 'receptionist']);
    const name = text(body.fullName, 'Họ tên', 255, true);
    const birth = body.dateOfBirth ? isoDate(body.dateOfBirth, 'Ngày sinh') : null;
    if (birth && birth > new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })) throw new BadRequestException('Ngày sinh không được trong tương lai');
    const sex = body.sex ?? 'unspecified';
    if (!['male', 'female', 'other', 'unspecified'].includes(String(sex))) throw new BadRequestException('Giới tính không hợp lệ');
    const userId = body.userId ? uuid(body.userId, 'Tài khoản bệnh nhân') : null;
    return this.db.transaction(async em => {
      if (userId && !(await em.query("SELECT id FROM users WHERE id=$1 AND role='user'", [userId])).length) throw new BadRequestException('Tài khoản liên kết phải là bệnh nhân');
      if (userId && (await em.query('SELECT id FROM clinic_patients WHERE user_id=$1', [userId])).length) throw new ConflictException('Tài khoản đã có mã bệnh nhân');
      const [row] = await em.query(`INSERT INTO clinic_patients(full_name,date_of_birth,sex,phone,address,user_id)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [name, birth, sex, text(body.phone, 'SĐT', 50), text(body.address, 'Địa chỉ', 1000), userId]);
      await this.audit(em, actor, 'patient.created', row.id);
      return row;
    });
  }

  async updatePatient(actor: ClinicActor, id: string, body: Input) {
    requireRole(actor, ['admin', 'receptionist', 'doctor']);
    return this.db.transaction(async em => {
      await this.canReadPatient(em, actor, id);
      const [row] = await em.query('SELECT * FROM clinic_patients WHERE id=$1 FOR UPDATE', [id]);
      assertVersion(row.version, version(body.version));
      if (actor.role === 'doctor' && ['fullName', 'phone', 'address', 'dateOfBirth', 'sex'].some(k => body[k] !== undefined)) throw new ForbiddenException('Bác sĩ chỉ cập nhật tiền sử và dị ứng');
      if (actor.role === 'receptionist' && (body.allergies !== undefined || body.medicalHistory !== undefined)) throw new ForbiddenException('Thông tin chuyên môn do bác sĩ cập nhật');
      const birth = body.dateOfBirth === undefined ? row.date_of_birth : body.dateOfBirth ? isoDate(body.dateOfBirth, 'Ngày sinh') : null;
      if (typeof birth === 'string' && birth > new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })) throw new BadRequestException('Ngày sinh không được trong tương lai');
      const sex = body.sex ?? row.sex;
      if (!['male', 'female', 'other', 'unspecified'].includes(String(sex))) throw new BadRequestException('Giới tính không hợp lệ');
      const [updated] = await em.query(`UPDATE clinic_patients SET full_name=$2,phone=$3,address=$4,date_of_birth=$5,sex=$6,
        allergies=$7,medical_history=$8,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`, [id,
        body.fullName === undefined ? row.full_name : text(body.fullName, 'Họ tên', 255, true),
        body.phone === undefined ? row.phone : text(body.phone, 'SĐT', 50), body.address === undefined ? row.address : text(body.address, 'Địa chỉ', 1000), birth, sex,
        body.allergies === undefined ? row.allergies : text(body.allergies, 'Dị ứng'), body.medicalHistory === undefined ? row.medical_history : text(body.medicalHistory, 'Tiền sử')]);
      await this.audit(em, actor, 'patient.updated', id, { version: updated.version });
      if (actor.role === 'receptionist') { delete updated.allergies; delete updated.medical_history; }
      return updated;
    });
  }

  async grantAccess(actor: ClinicActor, id: string, body: Input) {
    requireRole(actor, ['admin', 'receptionist']);
    if (body.confirmed !== true) throw new BadRequestException('Cần xác nhận đã kiểm tra quyền đại diện của người đăng ký');
    const account = uuid(body.userId, 'Tài khoản đại diện');
    const relationship = text(body.relationship, 'Quan hệ', 40, true);
    return this.db.transaction(async em => {
      await this.canReadPatient(em, actor, id);
      if (!(await em.query("SELECT id FROM users WHERE id=$1 AND role='user' AND is_locked=false", [account])).length) throw new BadRequestException('Tài khoản đại diện không khả dụng');
      await em.query(`INSERT INTO clinic_patient_access(patient_id,user_id,relationship,granted_by) VALUES($1,$2,$3,$4)
        ON CONFLICT(patient_id,user_id) DO UPDATE SET relationship=excluded.relationship,granted_by=excluded.granted_by`, [id, account, relationship, actor.id]);
      await this.audit(em, actor, 'patient.access_granted', id, { userId: account, relationship });
      return { ok: true };
    });
  }

  async revokeAccess(actor: ClinicActor, id: string, userId: string) {
    requireRole(actor, ['admin', 'receptionist']);
    return this.db.transaction(async em => {
      await this.canReadPatient(em, actor, id);
      await em.query('DELETE FROM clinic_patient_access WHERE patient_id=$1 AND user_id=$2', [id, userId]);
      await this.audit(em, actor, 'patient.access_revoked', id, { userId });
      return { ok: true };
    });
  }

  async doctors() {
    return this.db.query("SELECT id,full_name FROM users WHERE role='doctor' AND is_locked=false ORDER BY full_name");
  }

  async accounts(actor: ClinicActor, search: string) {
    requireRole(actor, ['admin', 'receptionist']);
    const query = text(search, 'Tìm tài khoản', 100) ?? '';
    if (query.length < 3) return [];
    return this.db.query("SELECT id,full_name,email,phone FROM users WHERE role='user' AND is_locked=false AND (email ILIKE $1 OR full_name ILIKE $1 OR phone ILIKE $1) ORDER BY full_name LIMIT 20", [`%${query}%`]);
  }

  async patientAccess(actor: ClinicActor, patientId: string) {
    requireRole(actor, ['admin', 'receptionist']);
    await this.canReadPatient(this.db, actor, patientId);
    return this.db.query('SELECT x.user_id,x.relationship,u.full_name,u.email FROM clinic_patient_access x JOIN users u ON u.id=x.user_id WHERE x.patient_id=$1 ORDER BY x.created_at', [patientId]);
  }

  async bookableAppointments(actor: ClinicActor, day: string) {
    requireRole(actor, ['admin', 'receptionist']);
    const date = isoDate(day, 'Ngày');
    return this.db.query(`SELECT a.id,u.full_name AS patient_name,u.phone,d.full_name AS doctor_name,s.slot_time,a.status,
      EXISTS(SELECT 1 FROM clinic_visits v WHERE v.appointment_id=a.id) AS imported FROM appointments a
      JOIN users u ON u.id=a.user_id JOIN users d ON d.id=a.doctor_id JOIN appointment_slots s ON s.id=a.slot_id
      WHERE a.status IN ('confirmed','completed') AND (s.slot_time::timestamp)::date=$1::date ORDER BY s.slot_time`, [date]);
  }

  async importAppointment(actor: ClinicActor, appointmentId: string) {
    requireRole(actor, ['admin', 'receptionist']);
    return this.db.transaction(async em => {
      const [identity] = await em.query('SELECT doctor_id FROM appointments WHERE id=$1', [appointmentId]);
      if (!identity) throw new NotFoundException('Không tìm thấy lịch hẹn');
      await lockDoctor(em, identity.doctor_id);
      const [a] = await em.query(`SELECT a.*,u.full_name,u.phone,s.slot_time AT TIME ZONE 'Asia/Ho_Chi_Minh' AS scheduled_at FROM appointments a JOIN users u ON u.id=a.user_id
        JOIN appointment_slots s ON s.id=a.slot_id WHERE a.id=$1 FOR UPDATE OF a`, [appointmentId]);
      if (!a || !['confirmed', 'completed'].includes(a.status)) throw new BadRequestException('Lịch chưa được xác nhận hoặc đã hủy');
      const [existing] = await em.query('SELECT * FROM clinic_visits WHERE appointment_id=$1', [appointmentId]);
      if (existing) return existing;
      const [p] = await em.query(`INSERT INTO clinic_patients(user_id,full_name,phone) VALUES($1,$2,$3)
        ON CONFLICT(user_id) DO UPDATE SET user_id=excluded.user_id RETURNING id`, [a.user_id, a.full_name, a.phone]);
      const config = await em.query("SELECT value FROM system_config WHERE key='consultation_fee'");
      const fee = config.length ? Number(config[0].value) : Number(a.deposit_amount ?? 50000);
      money(fee, 'Phí khám', true);
      const [visit] = await em.query(`INSERT INTO clinic_visits(patient_id,doctor_id,appointment_id,scheduled_at,source,status,consultation_fee,symptoms,created_by)
        VALUES($1,$2,$3,$4,'online',$5,$6,$7,$8) RETURNING *`, [p.id, a.doctor_id, a.id, a.scheduled_at, a.status === 'completed' ? 'completed' : 'scheduled', fee, a.symptoms, actor.id]);
      await this.creditPaidDeposits(em, actor, a.id, visit.id);
      await this.audit(em, actor, 'visit.imported', visit.id, { appointmentId });
      return visit;
    });
  }

  private async creditPaidDeposits(em: EntityManager, actor: ClinicActor, appointmentId: string, visitId: string) {
    const payments = await em.query(`SELECT p.* FROM payments p WHERE p.appointment_id=$1
      AND p.status='paid' AND p.payment_type='deposit' ORDER BY p.id FOR UPDATE`, [appointmentId]);
    for (const payment of payments) {
      const [linked] = await em.query('SELECT * FROM clinic_payment_links WHERE payment_id=$1', [payment.id]);
      if (linked) {
        if (linked.visit_id !== visitId) throw new ConflictException('Giao dịch đã được ghi nhận cho ca khác');
        if (Number(linked.credited_amount) !== Number(payment.amount)) throw new ConflictException('Số tiền giao dịch đã thay đổi; cần kiểm tra riêng');
        continue;
      }
      const amount = money(Number(payment.amount), 'Số tiền cọc đã xác nhận');
      const [entry] = await em.query(`INSERT INTO clinic_ledger(visit_id,kind,amount,method,reference,idempotency_key,recorded_by)
        VALUES($1,'deposit',$2,'payos',$3,$4,$5) RETURNING id`, [visitId, amount, payment.id, payment.id, actor.id]);
      await em.query(`INSERT INTO clinic_payment_links(payment_id,visit_id,ledger_id,credited_amount,created_by)
        VALUES($1,$2,$3,$4,$5)`, [payment.id, visitId, entry.id, amount, actor.id]);
      await this.audit(em, actor, 'payment.credited', visitId, { paymentId: payment.id, amount });
    }
  }

  /** Explicit financial intake; it never confirms an appointment or reserves a slot. */
  async reconcilePayment(actor: ClinicActor, paymentId: string, body: Input) {
    requireRole(actor, ['admin', 'cashier']);
    const note = text(body.note, 'Ghi chú đối soát', 1000, true);
    if (body.confirmed !== true) throw new BadRequestException('Cần xác nhận tiếp nhận giao dịch đã kiểm tra');
    return this.db.transaction(async em => {
      const [identity] = await em.query(`SELECT a.id,a.doctor_id FROM payments p
        JOIN appointments a ON a.id=p.appointment_id WHERE p.id=$1`, [paymentId]);
      if (!identity) throw new NotFoundException('Không tìm thấy giao dịch');
      await lockDoctor(em, identity.doctor_id);
      const [a] = await em.query(`SELECT a.*,u.full_name,u.phone,
        COALESCE(s.slot_time AT TIME ZONE 'Asia/Ho_Chi_Minh',a.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS scheduled_at
        FROM appointments a JOIN users u ON u.id=a.user_id LEFT JOIN appointment_slots s ON s.id=a.slot_id
        WHERE a.id=$1 FOR UPDATE OF a`, [identity.id]);
      if (a.status !== 'cancelled') throw new ConflictException('Chỉ tiếp nhận tài chính cho lịch đã hủy; không thay đổi lịch đang khám');
      const [payment] = await em.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [paymentId]);
      if (payment.status !== 'paid' || payment.payment_type !== 'deposit')
        throw new ConflictException('Chưa có tiền cọc đã xác nhận; không ghi nhận khoản tiền suy đoán');
      if (payment.reconciliation_status === 'resolved') throw new ConflictException('Giao dịch đã đối soát xong');
      const [p] = await em.query(`INSERT INTO clinic_patients(user_id,full_name,phone) VALUES($1,$2,$3)
        ON CONFLICT(user_id) DO UPDATE SET user_id=excluded.user_id RETURNING id`, [a.user_id, a.full_name, a.phone]);
      let [visit] = await em.query('SELECT * FROM clinic_visits WHERE appointment_id=$1 FOR UPDATE', [a.id]);
      if (visit && !['cancelled', 'no_show'].includes(visit.status)) throw new ConflictException('Ca tiếp đón chưa hủy; cần xử lý trạng thái trước khi đối soát');
      if (!visit) [visit] = await em.query(`INSERT INTO clinic_visits(patient_id,doctor_id,appointment_id,scheduled_at,source,status,consultation_fee,cancellation_reason,created_by)
        VALUES($1,$2,$3,$4,'online','cancelled',0,$5,$6) RETURNING *`, [p.id, a.doctor_id, a.id, a.scheduled_at, a.cancel_reason || 'Tiếp nhận giao dịch sau khi hủy lịch', actor.id]);
      await this.creditPaidDeposits(em, actor, a.id, visit.id);
      await em.query(`UPDATE payments SET reconciliation_status='needs_review'
        WHERE id=$1 AND reconciliation_status <> 'resolved'`, [paymentId]);
      await this.audit(em, actor, 'payment.reconciliation_intake', visit.id, { paymentId, note });
      return visit;
    });
  }

  async resolveReconciliation(actor: ClinicActor, visitId: string, body: Input) {
    requireRole(actor, ['admin', 'cashier']);
    const note = text(body.note, 'Kết quả đối soát', 1000, true);
    if (body.confirmed !== true) throw new BadRequestException('Cần xác nhận kết quả xử lý tài chính');
    return this.db.transaction(async em => {
      const visit = await this.visit(em, actor, visitId, true);
      if (!['cancelled','no_show'].includes(visit.status)) throw new ConflictException('Ca đang hoạt động không thuộc quy trình đối soát lịch hủy');
      const [balance] = await em.query('SELECT COALESCE(SUM(amount),0) AS balance FROM clinic_ledger WHERE visit_id=$1', [visitId]);
      const pending = await em.query("SELECT id FROM clinic_refunds WHERE visit_id=$1 AND status IN ('pending','approved')", [visitId]);
      if (Number(balance.balance) !== 0 || pending.length) throw new ConflictException('Còn tiền chưa hoàn/chuyển hoặc đề nghị chưa kết thúc');
      const payments = await em.query(`SELECT p.id FROM clinic_payment_links l JOIN payments p ON p.id=l.payment_id
        WHERE l.visit_id=$1 ORDER BY p.id FOR UPDATE OF p`, [visitId]);
      if (!payments.length) throw new ConflictException('Ca không có giao dịch trực tuyến cần đối soát');
      await em.query(`UPDATE payments SET reconciliation_status='resolved',reconciliation_reason=$2
        WHERE id=ANY($1::uuid[])`, [payments.map(p => p.id), `resolved:${note}`]);
      await this.audit(em, actor, 'payment.reconciliation_resolved', visitId, { paymentIds: payments.map(p => p.id), note });
      return { ok: true };
    });
  }

  async createVisit(actor: ClinicActor, body: Input) {
    requireRole(actor, ['admin', 'receptionist']);
    const patient = uuid(body.patientId, 'Bệnh nhân');
    const doctor = uuid(body.doctorId, 'Bác sĩ');
    let when = typeof body.scheduledAt === 'string' ? new Date(body.scheduledAt) : new Date(NaN);
    if (Number.isNaN(when.getTime())) throw new BadRequestException('Giờ hẹn không hợp lệ');
    if (!['walk_in', 'phone'].includes(String(body.source))) throw new BadRequestException('Nguồn đăng ký phải là tại quầy hoặc điện thoại');
    const fee = money(body.consultationFee, 'Phí khám', true);
    return this.db.transaction(async em => {
      await this.canReadPatient(em, actor, patient);
      await lockDoctor(em, doctor);
      await this.activeDoctor(em, doctor);
      let slotId: string | null = null;
      if (body.source === 'phone') {
        slotId = uuid(body.slotId, 'Khung giờ đặt qua điện thoại');
        const [slot] = await em.query(`SELECT *,slot_time AT TIME ZONE 'Asia/Ho_Chi_Minh' AS scheduled_at FROM appointment_slots
          WHERE id=$1 AND doctor_id=$2 FOR UPDATE`, [slotId, doctor]);
        if (!slot || slot.status !== 'available' || new Date(slot.scheduled_at).getTime() <= Date.now()) throw new ConflictException('Khung giờ không khả dụng');
        if ((await em.query(`SELECT 1 FROM doctor_leave_requests WHERE doctor_id=$1 AND status='approved'
          AND $2::date BETWEEN start_date AND end_date`, [doctor, new Date(slot.scheduled_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })])).length) throw new ConflictException('Bác sĩ đang nghỉ');
        when = new Date(slot.scheduled_at);
        await em.query("UPDATE appointment_slots SET status='booked' WHERE id=$1", [slotId]);
      }
      if ((await em.query("SELECT 1 FROM clinic_visits WHERE patient_id=$1 AND doctor_id=$2 AND status IN ('scheduled','checked_in','in_consultation') AND (scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date=($3::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date", [patient, doctor, when])).length) throw new ConflictException('Bệnh nhân đã có ca chưa hoàn tất với bác sĩ trong ngày');
      const [row] = await em.query(`INSERT INTO clinic_visits(patient_id,doctor_id,scheduled_at,source,consultation_fee,symptoms,created_by,slot_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [patient, doctor, when, body.source, fee, text(body.symptoms, 'Triệu chứng'), actor.id, slotId]);
      await this.audit(em, actor, 'visit.created', row.id, { source: body.source });
      return row;
    });
  }

  async visits(actor: ClinicActor, day: string, status = '') {
    const date = isoDate(day, 'Ngày');
    const rows = await this.db.query(`SELECT v.*,p.full_name AS patient_name,p.patient_code,p.phone,d.full_name AS doctor_name,
      e.id AS encounter_id,e.status AS encounter_status,e.follow_up_date,
      COALESCE((SELECT SUM(l.amount) FROM clinic_ledger l WHERE l.visit_id=v.id),0)::text AS paid_amount
      FROM clinic_visits v JOIN clinic_patients p ON p.id=v.patient_id JOIN users d ON d.id=v.doctor_id LEFT JOIN clinic_encounters e ON e.visit_id=v.id
      WHERE (v.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date=$1::date AND ($2::text='' OR v.status=$2)
      AND ($3::text IN ('admin','receptionist','cashier') OR ($3='doctor' AND v.doctor_id=$4) OR
       ($3='user' AND (p.user_id=$4 OR EXISTS(SELECT 1 FROM clinic_patient_access x WHERE x.patient_id=p.id AND x.user_id=$4))))
      ORDER BY CASE v.status WHEN 'in_consultation' THEN 0 WHEN 'checked_in' THEN 1 ELSE 2 END,v.checked_in_at NULLS LAST,v.scheduled_at,v.queue_number LIMIT 300`, [date, status, actor.role, actor.id]);
    if (!['admin','doctor','user'].includes(actor.role)) for (const row of rows) {
      delete row.symptoms; delete row.follow_up_date;
    }
    if (!['admin','cashier','user'].includes(actor.role)) for (const row of rows) delete row.paid_amount;
    return rows;
  }

  private async visit(db: Db, actor: ClinicActor, id: string, lock = false) {
    const [row] = await db.query(`SELECT v.*,d.full_name AS doctor_name FROM clinic_visits v JOIN users d ON d.id=v.doctor_id WHERE v.id=$1 ${lock ? 'FOR UPDATE OF v' : ''}`, [id]);
    if (!row) throw new NotFoundException('Không tìm thấy ca khám');
    if (actor.role === 'doctor' && row.doctor_id !== actor.id) throw new ForbiddenException('Không phải ca khám của bạn');
    if (!STAFF_ROLES.includes(actor.role)) await this.canReadPatient(db, actor, row.patient_id);
    return row;
  }

  async detail(actor: ClinicActor, id: string) {
    const visit = await this.visit(this.db, actor, id);
    const [patient] = await this.db.query(`SELECT id,patient_code,full_name,date_of_birth,sex,phone,address,version,
      ${['doctor', 'admin', 'user'].includes(actor.role) ? 'allergies,medical_history,' : ''}created_at FROM clinic_patients WHERE id=$1`, [visit.patient_id]);
    const clinical = ['doctor', 'admin', 'user'].includes(actor.role);
    if (!clinical) delete visit.symptoms;
    const encounters = clinical ? await this.db.query(`SELECT * FROM clinic_encounters WHERE visit_id=$1 ${actor.role === 'user' ? "AND status='final'" : ''}`, [id]) : [];
    const ledger = ['cashier', 'admin', 'user'].includes(actor.role) ? await this.db.query('SELECT * FROM clinic_ledger WHERE visit_id=$1 ORDER BY created_at,id', [id]) : [];
    const refunds = ['cashier', 'admin', 'user'].includes(actor.role) ? await this.db.query('SELECT * FROM clinic_refunds WHERE visit_id=$1 ORDER BY created_at DESC', [id]) : [];
    const revisions = ['doctor', 'admin'].includes(actor.role) && encounters.length ? await this.db.query(`SELECT r.*,u.full_name AS changed_by_name FROM clinic_encounter_revisions r JOIN users u ON u.id=r.changed_by
      WHERE r.encounter_id=$1 ORDER BY r.version DESC LIMIT 100`, [encounters[0].id]) : [];
    const [legacyMedicalRecord] = clinical && visit.appointment_id ? await this.db.query('SELECT id,version,symptoms,diagnosis,treatment,notes FROM medical_records WHERE appointment_id=$1', [visit.appointment_id]) : [];
    const reconciliation = ['cashier','admin'].includes(actor.role) ? await this.db.query(`SELECT p.id,p.amount,p.reconciliation_status,p.reconciliation_reason
      FROM clinic_payment_links l JOIN payments p ON p.id=l.payment_id WHERE l.visit_id=$1 ORDER BY p.created_at`, [id]) : [];
    return { visit, patient, encounter: encounters[0] ?? null, ledger, refunds, revisions, reconciliation, medicalRecordVersion: legacyMedicalRecord?.version ?? 0, legacyMedicalRecord: legacyMedicalRecord ?? null };
  }

  async transition(actor: ClinicActor, id: string, body: Input) {
    requireRole(actor, ['admin', 'receptionist', 'doctor']);
    return this.db.transaction(async em => {
      const [identity] = await em.query('SELECT doctor_id FROM clinic_visits WHERE id=$1', [id]);
      if (!identity) throw new NotFoundException('Không tìm thấy ca khám');
      await lockDoctor(em, identity.doctor_id);
      const row = await this.visit(em, actor, id, true);
      assertVersion(row.version, version(body.version));
      const next = String(body.status);
      assertVisitTransition(row.status, next);
      if (next === 'in_consultation') requireRole(actor, ['doctor', 'admin']);
      else requireRole(actor, ['receptionist', 'admin']);
      if (next === 'no_show' && new Date(row.scheduled_at).getTime() > Date.now()) throw new BadRequestException('Chưa đến giờ hẹn, không thể ghi vắng mặt');
      if (next === 'cancelled' && row.appointment_id) throw new BadRequestException('Hủy lịch trực tuyến bằng chức năng hủy lịch để trả slot và xử lý cọc');
      const reason = next === 'cancelled' ? text(body.reason, 'Lý do hủy', 1000, true) : null;
      const [updated] = await em.query(`UPDATE clinic_visits SET status=$2::varchar,version=version+1,updated_at=now(),
        checked_in_at=CASE WHEN $2::varchar='checked_in' THEN now() ELSE checked_in_at END,
        started_at=CASE WHEN $2::varchar='in_consultation' THEN now() ELSE started_at END,cancellation_reason=COALESCE($3,cancellation_reason)
        WHERE id=$1 RETURNING *`, [id, next, reason]);
      if (next === 'cancelled' && row.slot_id) await em.query("UPDATE appointment_slots SET status='available' WHERE id=$1 AND status='booked'", [row.slot_id]);
      await this.audit(em, actor, `visit.${next}`, id);
      return updated;
    });
  }

  async saveEncounter(actor: ClinicActor, visitId: string, body: Input) {
    requireRole(actor, ['doctor', 'admin']);
    const reason = text(body.reason, 'Lý do chỉnh sửa', 1000, true);
    const requestedVersion = body.version === 0 ? 0 : version(body.version);
    const status = body.finalize === true ? 'final' : 'draft';
    const diagnosis = text(body.diagnosis, 'Chẩn đoán');
    if (status === 'final' && !diagnosis) throw new BadRequestException('Cần chẩn đoán trước khi xác nhận hồ sơ');
    const measurements = vitals(body.vitals);
    const followUp = body.followUpDate ? isoDate(body.followUpDate, 'Ngày tái khám') : null;
    if (followUp && followUp < new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })) throw new BadRequestException('Ngày tái khám không được trong quá khứ');
    return this.db.transaction(async em => {
      const [identity] = await em.query('SELECT doctor_id FROM clinic_visits WHERE id=$1', [visitId]);
      if (!identity) throw new NotFoundException('Không tìm thấy ca khám');
      await lockDoctor(em, identity.doctor_id);
      const visit = await this.visit(em, actor, visitId, true);
      if (!['in_consultation', 'completed'].includes(visit.status)) throw new ConflictException('Bắt đầu khám trước khi nhập hồ sơ');
      const [current] = await em.query('SELECT * FROM clinic_encounters WHERE visit_id=$1 FOR UPDATE', [visitId]);
      if ((current?.version ?? 0) !== requestedVersion) throw new ConflictException('Hồ sơ đã thay đổi. Tải lại trước khi lưu.');
      if (current?.status === 'final' && status === 'draft') throw new ConflictException('Hồ sơ đã xác nhận chỉ được bổ sung bản xác nhận mới');
      const data = [visitId, status, JSON.stringify(measurements), text(body.symptoms, 'Triệu chứng'), diagnosis, text(body.treatment, 'Điều trị'), text(body.notes, 'Ghi chú'), followUp, actor.id];
      const [saved] = await em.query(`INSERT INTO clinic_encounters(visit_id,status,vitals,symptoms,diagnosis,treatment,notes,follow_up_date,updated_by,finalized_at)
        VALUES($1,$2::varchar,$3::jsonb,$4,$5,$6,$7,$8,$9,CASE WHEN $2::varchar='final' THEN now() ELSE null END)
        ON CONFLICT(visit_id) DO UPDATE SET status=excluded.status,vitals=excluded.vitals,symptoms=excluded.symptoms,diagnosis=excluded.diagnosis,
        treatment=excluded.treatment,notes=excluded.notes,follow_up_date=excluded.follow_up_date,updated_by=excluded.updated_by,
        version=clinic_encounters.version+1,updated_at=now(),finalized_at=CASE WHEN excluded.status='final' THEN now() ELSE clinic_encounters.finalized_at END RETURNING *`, data);
      await em.query('INSERT INTO clinic_encounter_revisions(encounter_id,version,snapshot,reason,changed_by) VALUES($1,$2,$3::jsonb,$4,$5)', [saved.id, saved.version, JSON.stringify(saved), reason, actor.id]);
      if (status === 'final') {
        if (visit.appointment_id) {
          const [appointment] = await em.query('SELECT * FROM appointments WHERE id=$1 FOR UPDATE', [visit.appointment_id]);
          if (!appointment || !['confirmed', 'completed'].includes(appointment.status)) throw new ConflictException('Lịch hẹn không còn ở trạng thái được phép hoàn tất');
          const [legacy] = await em.query('SELECT * FROM medical_records WHERE appointment_id=$1 FOR UPDATE', [visit.appointment_id]);
          if ((legacy?.version ?? 0) !== (body.medicalRecordVersion ?? 0)) throw new ConflictException('Kết quả khám đã được sửa ở màn hình khác. Tải lại trước khi xác nhận.');
          const combinedNotes = [saved.notes, Object.keys(measurements).length ? `Chỉ số khám: ${JSON.stringify(measurements)}` : null].filter(Boolean).join('\n') || null;
          const [medical] = legacy ? await em.query(`UPDATE medical_records SET symptoms=$2,diagnosis=$3,treatment=$4,notes=$5,version=version+1,
            updated_at=now(),embedding_status='pending' WHERE id=$1 RETURNING *`, [legacy.id, saved.symptoms, saved.diagnosis, saved.treatment, combinedNotes]) : await em.query(`INSERT INTO medical_records(patient_id,doctor_id,appointment_id,symptoms,diagnosis,treatment,notes,embedding_status)
            VALUES($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING *`, [appointment.user_id, appointment.doctor_id, appointment.id, saved.symptoms, saved.diagnosis, saved.treatment, combinedNotes]);
          await em.query('INSERT INTO medical_record_revisions(record_id,version,actor_id,reason,snapshot) VALUES($1,$2,$3,$4,$5::jsonb)', [medical.id, medical.version, actor.id, reason, JSON.stringify(medical)]);
        }
        await em.query("UPDATE clinic_visits SET status='completed',completed_at=COALESCE(completed_at,now()),version=version+1,updated_at=now() WHERE id=$1", [visitId]);
        if (visit.appointment_id) await em.query("UPDATE appointments SET status='completed' WHERE id=$1 AND status='confirmed'", [visit.appointment_id]);
      }
      await this.audit(em, actor, `encounter.${status}`, visitId, { version: saved.version });
      return saved;
    });
  }

  async collect(actor: ClinicActor, visitId: string, body: Input) {
    requireRole(actor, ['cashier', 'admin']);
    const amount = money(body.amount);
    const key = uuid(body.idempotencyKey, 'Mã thao tác');
    if (!['cash', 'bank'].includes(String(body.method))) throw new BadRequestException('Chọn tiền mặt hoặc chuyển khoản');
    const reference = text(body.reference, 'Mã giao dịch', 200, body.method === 'bank');
    if (body.confirmed !== true) throw new BadRequestException('Xác nhận đã nhận tiền thực tế trước khi ghi nhận');
    return this.db.transaction(async em => {
      const visit = await this.visit(em, actor, visitId, true);
      const [previous] = await em.query('SELECT * FROM clinic_ledger WHERE idempotency_key=$1', [key]);
      if (previous) {
        if (previous.visit_id !== visitId || previous.kind !== 'collection' || Number(previous.amount) !== amount || previous.method !== body.method || previous.reference !== reference) throw new ConflictException('Mã thao tác đã được dùng cho nội dung khác');
        return previous;
      }
      if (['cancelled', 'no_show'].includes(visit.status)) throw new ConflictException('Không thu thêm cho ca đã hủy/vắng mặt');
      const [balance] = await em.query('SELECT COALESCE(SUM(amount),0)::text AS paid FROM clinic_ledger WHERE visit_id=$1', [visitId]);
      if (amount > Number(visit.consultation_fee) - Number(balance.paid)) throw new BadRequestException('Số tiền vượt phần còn phải thu');
      const [row] = await em.query(`INSERT INTO clinic_ledger(visit_id,kind,amount,method,reference,idempotency_key,recorded_by)
        VALUES($1,'collection',$2,$3,$4,$5,$6) RETURNING *`, [visitId, amount, body.method, reference, key, actor.id]);
      await this.audit(em, actor, 'cash.collected', visitId, { ledgerId: row.id, amount });
      return row;
    });
  }

  private async availableCredit(db: Db, visitId: string) {
    const [row] = await db.query(`SELECT COALESCE((SELECT SUM(amount) FROM clinic_ledger WHERE visit_id=$1),0)-
      COALESCE((SELECT SUM(amount) FROM clinic_refunds WHERE visit_id=$1 AND status IN ('pending','approved')),0) AS available`, [visitId]);
    return Number(row.available);
  }

  async requestRefund(actor: ClinicActor, visitId: string, body: Input) {
    requireRole(actor, ['cashier', 'admin']);
    const amount = money(body.amount);
    const key = uuid(body.idempotencyKey, 'Mã thao tác');
    const reason = text(body.reason, 'Lý do hoàn', 1000, true);
    return this.db.transaction(async em => {
      await this.visit(em, actor, visitId, true);
      const [previous] = await em.query('SELECT * FROM clinic_refunds WHERE idempotency_key=$1', [key]);
      if (previous) {
        if (previous.visit_id !== visitId || Number(previous.amount) !== amount || previous.reason !== reason)
          throw new ConflictException('Mã thao tác đã dùng cho nội dung khác');
        return previous;
      }
      if (amount > await this.availableCredit(em, visitId)) throw new BadRequestException('Số tiền vượt khoản có thể đề nghị hoàn');
      const [row] = await em.query('INSERT INTO clinic_refunds(visit_id,amount,reason,requested_by,idempotency_key) VALUES($1,$2,$3,$4,$5) RETURNING *', [visitId, amount, reason, actor.id, key]);
      await this.audit(em, actor, 'refund.requested', visitId, { refundId: row.id, amount });
      return row;
    });
  }

  async reviewRefund(actor: ClinicActor, id: string, body: Input) {
    requireRole(actor, ['admin']);
    if (typeof body.approve !== 'boolean') throw new BadRequestException('Chọn duyệt hoặc từ chối');
    const note = text(body.note, 'Ý kiến duyệt', 1000, true);
    return this.db.transaction(async em => {
      const [ref] = await em.query('SELECT visit_id FROM clinic_refunds WHERE id=$1', [id]);
      if (!ref) throw new NotFoundException('Không tìm thấy đề nghị hoàn');
      await this.visit(em, actor, ref.visit_id, true);
      const [row] = await em.query('SELECT * FROM clinic_refunds WHERE id=$1 FOR UPDATE', [id]);
      if (row.status !== 'pending') throw new ConflictException('Đề nghị đã được xử lý');
      if (row.requested_by === actor.id && body.approve) throw new ForbiddenException('Người đề nghị không tự duyệt hoàn tiền');
      const [updated] = await em.query('UPDATE clinic_refunds SET status=$2,reviewed_by=$3,review_note=$4,reviewed_at=now() WHERE id=$1 RETURNING *', [id, body.approve ? 'approved' : 'rejected', actor.id, note]);
      await this.audit(em, actor, `refund.${updated.status}`, ref.visit_id, { refundId: id });
      return updated;
    });
  }

  async payRefund(actor: ClinicActor, id: string, body: Input) {
    requireRole(actor, ['cashier', 'admin']);
    const reference = text(body.reference, 'Chứng từ hoàn tiền', 200, true);
    if (body.confirmed !== true) throw new BadRequestException('Chỉ xác nhận sau khi đã hoàn tiền thực tế');
    return this.db.transaction(async em => {
      const [ref] = await em.query('SELECT visit_id FROM clinic_refunds WHERE id=$1', [id]);
      if (!ref) throw new NotFoundException('Không tìm thấy đề nghị hoàn');
      await this.visit(em, actor, ref.visit_id, true);
      const [row] = await em.query('SELECT * FROM clinic_refunds WHERE id=$1 FOR UPDATE', [id]);
      if (row.status === 'paid') {
        if (row.payment_reference !== reference) throw new ConflictException('Đề nghị đã hoàn với chứng từ khác');
        return row;
      }
      if (row.status !== 'approved') throw new ConflictException('Chỉ hoàn sau khi quản trị duyệt');
      await em.query(`INSERT INTO clinic_ledger(visit_id,kind,amount,method,reference,reason,idempotency_key,recorded_by)
        VALUES($1,'refund',$2,'manual',$3,$4,$5,$6)`, [ref.visit_id, -Number(row.amount), reference, row.reason, row.id, actor.id]);
      const [updated] = await em.query("UPDATE clinic_refunds SET status='paid',payment_reference=$2,paid_at=now() WHERE id=$1 RETURNING *", [id, reference]);
      await this.audit(em, actor, 'refund.paid', ref.visit_id, { refundId: id, amount: Number(row.amount) });
      return updated;
    });
  }

  async transfer(actor: ClinicActor, id: string, body: Input) {
    requireRole(actor, ['cashier', 'admin']);
    const target = uuid(body.targetVisitId, 'Ca nhận cọc');
    if (target === id) throw new BadRequestException('Ca nhận phải khác ca chuyển');
    const amount = money(body.amount);
    const key = uuid(body.idempotencyKey, 'Mã thao tác');
    const reason = text(body.reason, 'Lý do chuyển', 1000, true);
    if (body.confirmed !== true) throw new BadRequestException('Cần xác nhận chuyển khoản đã thu giữa hai ca');
    return this.db.transaction(async em => {
      // Consistent lock order prevents A->B and B->A transfer deadlocks.
      const visits = new Map<string, any>();
      for (const visitId of [id, target].sort()) visits.set(visitId, await this.visit(em, actor, visitId, true));
      const source = visits.get(id), dest = visits.get(target);
      if (source.patient_id !== dest.patient_id) throw new BadRequestException('Chỉ chuyển cọc giữa các ca của cùng bệnh nhân');
      if (!['cancelled', 'no_show'].includes(source.status)) throw new BadRequestException('Chỉ chuyển khoản đã thu từ ca hủy/vắng mặt');
      if (['cancelled', 'no_show'].includes(dest.status)) throw new BadRequestException('Ca nhận không còn hiệu lực');
      const [previous] = await em.query('SELECT * FROM clinic_ledger WHERE idempotency_key=$1', [key]);
      if (previous) {
        if (previous.visit_id !== id || previous.kind !== 'transfer_out' || Number(previous.amount) !== -amount || previous.reference !== target) throw new ConflictException('Mã thao tác đã dùng cho nội dung khác');
        return previous;
      }
      if (amount > await this.availableCredit(em, id)) throw new BadRequestException('Không đủ khoản đã thu để chuyển');
      const [destPaid] = await em.query('SELECT COALESCE(SUM(amount),0) AS amount FROM clinic_ledger WHERE visit_id=$1', [target]);
      if (amount > Number(dest.consultation_fee) - Number(destPaid.amount)) throw new BadRequestException('Khoản chuyển vượt phần còn phải thu của ca nhận');
      const [entry] = await em.query(`INSERT INTO clinic_ledger(visit_id,kind,amount,method,reference,reason,idempotency_key,recorded_by)
        VALUES($1,'transfer_out',$2,'internal',$3,$4,$5,$6) RETURNING *`, [id, -amount, target, reason, key, actor.id]);
      await em.query(`INSERT INTO clinic_ledger(visit_id,kind,amount,method,reference,reason,idempotency_key,recorded_by)
        VALUES($1,'transfer_in',$2,'internal',$3,$4,$5,$6)`, [target, amount, id, reason, randomUUID(), actor.id]);
      await this.audit(em, actor, 'deposit.transferred', id, { targetVisitId: target, amount });
      return entry;
    });
  }

  async waitlist(actor: ClinicActor) {
    return this.db.query(`SELECT w.*,p.full_name AS patient_name,p.patient_code,d.full_name AS doctor_name,s.slot_time
      FROM clinic_waitlist w JOIN clinic_patients p ON p.id=w.patient_id JOIN users d ON d.id=w.doctor_id
      LEFT JOIN appointment_slots s ON s.id=w.offered_slot_id WHERE
      $1::text IN ('admin','receptionist') OR ($1='doctor' AND w.doctor_id=$2) OR
      ($1='user' AND (p.user_id=$2 OR EXISTS(SELECT 1 FROM clinic_patient_access x WHERE x.patient_id=p.id AND x.user_id=$2)))
      ORDER BY w.preferred_date,w.created_at LIMIT 200`, [actor.role, actor.id]);
  }

  async addWaitlist(actor: ClinicActor, body: Input) {
    requireRole(actor, ['admin', 'receptionist', 'user']);
    const patient = uuid(body.patientId, 'Bệnh nhân'), doctor = uuid(body.doctorId, 'Bác sĩ');
    const date = isoDate(body.preferredDate, 'Ngày mong muốn');
    if (date < new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })) throw new BadRequestException('Ngày mong muốn không được trong quá khứ');
    return this.db.transaction(async em => {
      await this.canReadPatient(em, actor, patient);
      await this.activeDoctor(em, doctor);
      const [row] = await em.query('INSERT INTO clinic_waitlist(patient_id,doctor_id,preferred_date,note,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *', [patient, doctor, date, text(body.note, 'Ghi chú', 1000), actor.id]);
      await this.audit(em, actor, 'waitlist.added', row.id);
      return row;
    });
  }

  async offerWaitlist(actor: ClinicActor, id: string, body: Input) {
    requireRole(actor, ['admin', 'receptionist']);
    const slotId = uuid(body.slotId, 'Khung giờ');
    return this.db.transaction(async em => {
      const [row] = await em.query('SELECT * FROM clinic_waitlist WHERE id=$1 FOR UPDATE', [id]);
      if (!row || !['waiting', 'offered'].includes(row.status)) throw new ConflictException('Yêu cầu chờ không còn hiệu lực');
      const [slot] = await em.query("SELECT * FROM appointment_slots WHERE id=$1 AND doctor_id=$2 AND status='available' AND (slot_time AT TIME ZONE 'Asia/Ho_Chi_Minh')>now()", [slotId, row.doctor_id]);
      if (!slot) throw new ConflictException('Khung giờ không khả dụng');
      const [updated] = await em.query("UPDATE clinic_waitlist SET status='offered',offered_slot_id=$2,updated_at=now() WHERE id=$1 RETURNING *", [id, slotId]);
      await this.audit(em, actor, 'waitlist.offered', id, { slotId });
      return updated;
    });
  }

  async confirmWaitlist(actor: ClinicActor, id: string, body: Input) {
    requireRole(actor, ['admin', 'receptionist', 'user']);
    if (body.confirmed !== true) throw new BadRequestException('Cần xác nhận bệnh nhân đồng ý khung giờ');
    return this.db.transaction(async em => {
      const [row] = await em.query('SELECT * FROM clinic_waitlist WHERE id=$1 FOR UPDATE', [id]);
      if (!row) throw new NotFoundException('Không tìm thấy yêu cầu');
      await this.canReadPatient(em, actor, row.patient_id);
      if (row.status === 'confirmed') return row;
      if (row.status !== 'offered') throw new ConflictException('Chưa có khung giờ đề nghị');
      // Confirmation records agreement only. The normal booking API owns slot locking/deposit.
      const [slot] = await em.query("SELECT id FROM appointment_slots WHERE id=$1 AND status='available' AND (slot_time AT TIME ZONE 'Asia/Ho_Chi_Minh')>now()", [row.offered_slot_id]);
      if (!slot) throw new ConflictException('Khung giờ không còn trống. Yêu cầu lễ tân đề nghị lại.');
      const [updated] = await em.query("UPDATE clinic_waitlist SET status='confirmed',updated_at=now() WHERE id=$1 RETURNING *", [id]);
      await this.audit(em, actor, 'waitlist.confirmed', id, { slotId: row.offered_slot_id });
      return { ...updated, requiresBooking: true };
    });
  }

  async cancelWaitlist(actor: ClinicActor, id: string) {
    requireRole(actor, ['admin', 'receptionist', 'user']);
    return this.db.transaction(async em => {
      const [row] = await em.query('SELECT * FROM clinic_waitlist WHERE id=$1 FOR UPDATE', [id]);
      if (!row) throw new NotFoundException('Không tìm thấy yêu cầu');
      await this.canReadPatient(em, actor, row.patient_id);
      await em.query("UPDATE clinic_waitlist SET status='cancelled',updated_at=now() WHERE id=$1", [id]);
      await this.audit(em, actor, 'waitlist.cancelled', id);
      return { ok: true };
    });
  }

  async followUps(actor: ClinicActor) {
    requireRole(actor, ['admin', 'receptionist', 'doctor', 'user']);
    return this.db.query(`SELECT v.id AS visit_id,v.patient_id,v.doctor_id,p.full_name AS patient_name,p.patient_code,p.phone,
      d.full_name AS doctor_name,e.follow_up_date FROM clinic_encounters e JOIN clinic_visits v ON v.id=e.visit_id
      JOIN clinic_patients p ON p.id=v.patient_id JOIN users d ON d.id=v.doctor_id WHERE e.status='final' AND e.follow_up_date IS NOT NULL
      AND ($1::text IN ('admin','receptionist') OR ($1='doctor' AND v.doctor_id=$2) OR
      ($1='user' AND (p.user_id=$2 OR EXISTS(SELECT 1 FROM clinic_patient_access x WHERE x.patient_id=p.id AND x.user_id=$2))))
      ORDER BY e.follow_up_date DESC LIMIT 200`, [actor.role, actor.id]);
  }

  async operations(actor: ClinicActor) {
    requireRole(actor, ['admin', 'receptionist', 'cashier']);
    const financial = ['admin', 'cashier'].includes(actor.role);
    const unimported = actor.role === 'cashier' ? [] : await this.db.query(`SELECT a.id,u.full_name AS patient_name,s.slot_time FROM appointments a
      JOIN users u ON u.id=a.user_id JOIN appointment_slots s ON s.id=a.slot_id LEFT JOIN clinic_visits v ON v.appointment_id=a.id
      WHERE a.status='confirmed' AND v.id IS NULL AND s.slot_time >= now()-interval '1 day' AND s.slot_time < now()+interval '7 days'
      ORDER BY s.slot_time LIMIT 100`);
    const unfinished = await this.db.query(`SELECT v.id,p.full_name AS patient_name,v.status,v.scheduled_at,d.full_name AS doctor_name
      FROM clinic_visits v JOIN clinic_patients p ON p.id=v.patient_id JOIN users d ON d.id=v.doctor_id
      WHERE v.status IN ('checked_in','in_consultation') ORDER BY v.scheduled_at LIMIT 100`);
    const reconciliation = financial ? await this.db.query(`SELECT p.id,p.appointment_id,p.amount,p.status,a.status AS appointment_status,p.payos_order_code
      FROM payments p JOIN appointments a ON a.id=p.appointment_id WHERE p.reconciliation_status <> 'resolved' AND
      ((p.status='paid' AND a.status='cancelled') OR p.reconciliation_status <> 'clear') ORDER BY p.created_at DESC LIMIT 100`) : [];
    const refunds = financial ? await this.db.query(`SELECT r.*,p.full_name AS patient_name FROM clinic_refunds r JOIN clinic_visits v ON v.id=r.visit_id
      JOIN clinic_patients p ON p.id=v.patient_id WHERE r.status IN ('pending','approved') ORDER BY r.created_at LIMIT 100`) : [];
    const reminders = actor.role === 'cashier' ? [] : await this.db.query(`SELECT appointment_id,kind,status,attempts,
      CASE WHEN last_error IS NOT NULL THEN 'Không gửi được nhắc lịch; kiểm tra hệ thống gửi thư và thử lại theo lịch tác vụ.' ELSE null END AS last_error,next_attempt_at FROM appointment_reminders
      WHERE status IN ('failed','processing') ORDER BY sent_at DESC LIMIT 100`);
    return { unimported, unfinished, reconciliation, refunds, reminders };
  }

  async operationTasks(actor: ClinicActor) {
    requireRole(actor, ['admin', 'receptionist', 'cashier']);
    return this.db.query(`SELECT t.*,u.full_name AS assignee_name,
      CASE t.kind WHEN 'visit' THEN (SELECT p.full_name FROM clinic_visits v JOIN clinic_patients p ON p.id=v.patient_id WHERE v.id=t.target_id)
      WHEN 'refund' THEN (SELECT p.full_name FROM clinic_refunds r JOIN clinic_visits v ON v.id=r.visit_id JOIN clinic_patients p ON p.id=v.patient_id WHERE r.id=t.target_id)
      WHEN 'reconciliation' THEN (SELECT 'PayOS ' || COALESCE(p.payos_order_code::text,'') FROM payments p WHERE p.id=t.target_id)
      WHEN 'reminder' THEN (SELECT u.full_name FROM appointments a JOIN users u ON u.id=a.user_id WHERE a.id=t.target_id) END AS target_label
      FROM clinic_operation_tasks t JOIN users u ON u.id=t.assigned_to
      WHERE $1='admin' OR ($1='cashier' AND t.kind IN ('reconciliation','refund')) OR ($1='receptionist' AND t.kind IN ('reminder','visit'))
      ORDER BY CASE t.status WHEN 'in_progress' THEN 0 ELSE 1 END,t.updated_at DESC LIMIT 200`, [actor.role]);
  }

  private taskAuthority(actor: ClinicActor, kind: string) {
    requireRole(actor, kind === 'reconciliation' || kind === 'refund' ? ['admin', 'cashier'] : ['admin', 'receptionist']);
    if (!['reminder', 'reconciliation', 'visit', 'refund'].includes(kind)) throw new BadRequestException('Loại công việc không hợp lệ');
  }

  async claimTask(actor: ClinicActor, body: Input) {
    const kind = String(body.kind);
    this.taskAuthority(actor, kind);
    const target = uuid(body.targetId, 'Công việc cần xử lý');
    return this.db.transaction(async em => {
      const sources: Record<string, string> = {
        reminder: "SELECT 1 FROM appointment_reminders WHERE appointment_id=$1 AND status IN ('failed','processing')",
        reconciliation: "SELECT 1 FROM payments p JOIN appointments a ON a.id=p.appointment_id WHERE p.id=$1 AND p.reconciliation_status <> 'resolved' AND ((p.status='paid' AND a.status='cancelled') OR p.reconciliation_status <> 'clear')",
        visit: "SELECT 1 FROM clinic_visits WHERE id=$1 AND status IN ('checked_in','in_consultation')",
        refund: "SELECT 1 FROM clinic_refunds WHERE id=$1 AND status IN ('pending','approved')",
      };
      if (!(await em.query(sources[kind], [target])).length) throw new ConflictException('Công việc không còn cần xử lý');
      await em.query(`INSERT INTO clinic_operation_tasks(kind,target_id,assigned_to) VALUES($1,$2,$3) ON CONFLICT(kind,target_id) DO NOTHING`, [kind, target, actor.id]);
      const [row] = await em.query('SELECT * FROM clinic_operation_tasks WHERE kind=$1 AND target_id=$2 FOR UPDATE', [kind, target]);
      if (row.assigned_to !== actor.id && actor.role !== 'admin') throw new ConflictException('Công việc đã có người nhận xử lý');
      if (row.status === 'resolved') throw new ConflictException('Công việc đã được ghi nhận xử lý. Kiểm tra nguyên nhân vẫn còn trong danh sách ngoại lệ.');
      const [updated] = row.assigned_to === actor.id ? [row] : await em.query('UPDATE clinic_operation_tasks SET assigned_to=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *', [row.id, actor.id]);
      await this.audit(em, actor, 'operation.claimed', row.id, { kind, targetId: target });
      return updated;
    });
  }

  async updateTask(actor: ClinicActor, id: string, body: Input) {
    const note = text(body.note, 'Kết quả / ghi chú xử lý', 1000, true);
    if (!['in_progress', 'resolved'].includes(String(body.status))) throw new BadRequestException('Trạng thái công việc không hợp lệ');
    return this.db.transaction(async em => {
      const [row] = await em.query('SELECT * FROM clinic_operation_tasks WHERE id=$1 FOR UPDATE', [id]);
      if (!row) throw new NotFoundException('Không tìm thấy công việc');
      this.taskAuthority(actor, row.kind);
      if (row.assigned_to !== actor.id && actor.role !== 'admin') throw new ForbiddenException('Chỉ người nhận việc hoặc quản trị được cập nhật');
      assertVersion(row.version, version(body.version));
      const [updated] = await em.query('UPDATE clinic_operation_tasks SET status=$2,note=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *', [id, body.status, note]);
      await this.audit(em, actor, `operation.${body.status}`, id, { targetId: row.target_id, kind: row.kind });
      return updated;
    });
  }

  async auditTrail(actor: ClinicActor, targetId: string) {
    requireRole(actor, ['admin']);
    return this.db.query('SELECT a.*,u.full_name AS actor_name FROM clinic_audit a JOIN users u ON u.id=a.actor_id WHERE target_id=$1 ORDER BY created_at DESC LIMIT 200', [targetId]);
  }
}
