import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { randomInt } from 'crypto';
import { AppointmentEntity } from '../models/appointment.model';
import { PaymentEntity } from '../models/payment.model';
import { AppointmentSlotEntity } from '../models/appointment-slot.model';
import { AppointmentStatus, PaymentStatus, PaymentType, SlotStatus } from '../models/enums';
import { PayOSService } from '../payos/payos.service';
import { ConfigService } from '@nestjs/config';
import { lockDoctor } from '../common/doctor-lock';

const TTL_MS = 5 * 60_000;
// TypeORM pg mutation queries return [returnedRows, affectedCount], SELECT returns rows.
function affectedCount(result:unknown[]):number {
  return Array.isArray(result[0]) && typeof result[1]==='number' ? result[1] : result.length;
}
export interface CreateBookingDto { slotId: string; symptoms?: string | null }
export interface CreateBookingResult { appointment: AppointmentEntity; payment: PaymentEntity; checkoutUrl: string }
export interface AppointmentWithDetailsDto {
  id: string; userId: string; doctorId: string; slotId: string | null; symptoms: string | null;
  status: string; depositAmount: number | null; createdAt: Date;
  doctor: { fullName: string; avatarUrl: string | null; departmentName: string | null } | null;
  slot: { slotTime: Date } | null; hasMedicalRecord: boolean; cancelReason: string | null; cancelledAt: Date | null;
}
export interface PaymentHistoryItemDto {
  id: string; amount: number; paymentType: string | null; paymentMethod: string | null; status: string;
  createdAt: Date; payosOrderCode: number | null;
  appointment: { id: string; status: string; slotTime: Date | null;
    doctor: { fullName: string; avatarUrl: string | null; departmentName: string | null } | null } | null;
}

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);
  constructor(
    @InjectRepository(AppointmentEntity) private readonly appointmentRepo: Repository<AppointmentEntity>,
    @InjectRepository(PaymentEntity) private readonly paymentRepo: Repository<PaymentEntity>,
    @InjectRepository(AppointmentSlotEntity) private readonly slotRepo: Repository<AppointmentSlotEntity>,
    private readonly dataSource: DataSource, private readonly payos: PayOSService, private readonly config: ConfigService,
  ) {}

  private async ensureDoctor(em: EntityManager, doctorId: string, slotTime: Date): Promise<void> {
    const active = await em.query(`SELECT id FROM users WHERE id=$1 AND role='doctor' AND NOT is_locked`, [doctorId]);
    if (!active.length) throw new ConflictException('Bác sĩ hiện không nhận lịch khám');
    const unavailable = await em.query(`SELECT 1 FROM doctor_leave_requests WHERE doctor_id=$1 AND status='approved'
      AND ($2::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN start_date AND end_date
      UNION ALL SELECT 1 FROM doctor_schedule_exceptions WHERE doctor_id=$1 AND closed
      AND work_date=($2::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`, [doctorId, slotTime.toISOString()]);
    if (unavailable.length) throw new ConflictException('Bác sĩ nghỉ trong ngày đã chọn');
  }

  private returnAddress(raw: string, appointmentId: string, canceled: boolean): string {
    const base = this.config.get<string>('CLIENT_APP_URL') || 'http://localhost:5431';
    const allowed = new URL(base);
    let target: URL;
    try { target = new URL(raw || base); } catch { throw new BadRequestException('URL trả về không hợp lệ'); }
    if (target.origin !== allowed.origin) throw new BadRequestException('URL trả về phải thuộc ứng dụng');
    target.search = '';
    target.searchParams.set('view', 'booking-success');
    target.searchParams.set('appointmentId', appointmentId);
    if (canceled) target.searchParams.set('payment', 'cancel');
    return target.toString();
  }

  async createBooking(userId: string, dto: CreateBookingDto, returnUrl: string, cancelUrl: string): Promise<CreateBookingResult> {
    this.returnAddress(returnUrl, 'validation', false);
    this.returnAddress(cancelUrl, 'validation', true);
    if (typeof dto.symptoms !== 'undefined' && dto.symptoms !== null && (typeof dto.symptoms !== 'string' || dto.symptoms.length > 4000))
      throw new BadRequestException('Triệu chứng tối đa 4000 ký tự');
    const initial = await this.slotRepo.findOne({ where: { id: dto.slotId } });
    if (!initial) throw new NotFoundException('Không tìm thấy ca khám');
    const reservation = await this.dataSource.transaction(async em => {
      await lockDoctor(em, initial.doctorId);
      const slot = await em.findOneOrFail(AppointmentSlotEntity, { where: { id: initial.id }, lock: { mode: 'pessimistic_write' } });
      await this.ensureDoctor(em, slot.doctorId, new Date(slot.slotTime));
      if (new Date(slot.slotTime).getTime() <= Date.now()) throw new BadRequestException('Ca khám đã qua');
      const existing = await em.findOne(AppointmentEntity, { where: { userId, slotId: slot.id, status: AppointmentStatus.Pending } });
      if (existing) {
        const payment = await em.findOneOrFail(PaymentEntity, { where: { appointmentId: existing.id } });
        if (payment.expiresAt && new Date(payment.expiresAt).getTime() <= Date.now())
          throw new ConflictException('Lịch chờ đã hết hạn; vui lòng chờ trả ca và đặt lại');
        return { appointment: existing, payment };
      }
      if (slot.status !== SlotStatus.Available) throw new ConflictException('Ca khám đã được giữ chỗ');
      await em.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`patient:${userId}`]);
      const overlapping = await em.query(`SELECT a.id FROM appointments a JOIN appointment_slots s ON s.id=a.slot_id
        WHERE a.user_id=$1 AND a.status IN ('pending','confirmed') AND s.slot_time=$2`, [userId, slot.slotTime]);
      if (overlapping.length) throw new ConflictException('Bạn đã có lịch khám tại thời điểm này');
      const config = await em.query(`SELECT value FROM system_config WHERE key='deposit_amount'`);
      const amount = Number(config[0]?.value ?? 50000);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new ServiceUnavailableException('Tiền cọc chưa được cấu hình hợp lệ');
      slot.status = SlotStatus.Booked;
      await em.save(slot);
      const appointment = await em.save(AppointmentEntity, { userId, doctorId: slot.doctorId, slotId: slot.id,
        symptoms: dto.symptoms?.trim() || null, depositAmount: amount, status: AppointmentStatus.Pending });
      const payment = await em.save(PaymentEntity, { appointmentId: appointment.id, amount,
        paymentType: PaymentType.Deposit, paymentMethod: 'payos', status: PaymentStatus.Pending,
        payosOrderCode: randomInt(1_000_000_000_000, 9_000_000_000_000), expiresAt: new Date(Date.now() + TTL_MS) });
      return { appointment, payment };
    });
    const { appointment, payment } = reservation;
    payment.payosOrderCode = Number(payment.payosOrderCode);
    payment.amount = Number(payment.amount);
    if (payment.checkoutUrl) return { ...reservation, checkoutUrl: payment.checkoutUrl };
    const ret = this.returnAddress(returnUrl, appointment.id, false);
    const cancel = this.returnAddress(cancelUrl, appointment.id, true);
    // The reservation commits first. No row lock is held across a provider request.
    // A retry uses the same orderCode and expiration rather than creating another charge.
    try {
      const link = await this.payos.ensurePaymentLink({ orderCode: Number(payment.payosOrderCode), amount: Number(payment.amount),
        description: 'Coc kham', returnUrl: ret, cancelUrl: cancel, expiredAt: Math.floor(new Date(payment.expiresAt!).getTime()/1000) });
      payment.checkoutUrl = link.checkoutUrl;
      payment.paymentLinkId = link.paymentLinkId;
      await this.paymentRepo.update(payment.id, { checkoutUrl: link.checkoutUrl, paymentLinkId: link.paymentLinkId });
      return { ...reservation, checkoutUrl: link.checkoutUrl };
    } catch {
      throw new ServiceUnavailableException('Chưa mở được thanh toán; lịch đang giữ 5 phút. Thử lại để tiếp tục cùng lịch.');
    }
  }

  async findMyAppointments(userId: string, page = 1, pageSize = 50): Promise<AppointmentWithDetailsDto[]> {
    const list = await this.appointmentRepo.find({ where: { userId }, order: { createdAt: 'DESC' },
      relations: ['doctor','doctor.department','slot'], skip: (page-1)*pageSize, take: pageSize });
    if (!list.length) return [];
    const rows = await this.dataSource.query('SELECT appointment_id FROM medical_records WHERE appointment_id=ANY($1::uuid[])', [list.map(a => a.id)]);
    const records = new Set(rows.map((r: { appointment_id: string }) => r.appointment_id));
    return list.map(a => ({ id: a.id, userId: a.userId, doctorId: a.doctorId, slotId: a.slotId, symptoms: a.symptoms,
      status: a.status, depositAmount: a.depositAmount == null ? null : Number(a.depositAmount), createdAt: a.createdAt,
      doctor: a.doctor ? { fullName: a.doctor.fullName, avatarUrl: a.doctor.avatarUrl, departmentName: a.doctor.department?.name ?? null } : null,
      slot: a.slot ? { slotTime: a.slot.slotTime } : null, hasMedicalRecord: records.has(a.id),
      cancelReason: a.cancelReason, cancelledAt: a.cancelledAt }));
  }

  async findMyPayments(userId: string, page=1, pageSize=50): Promise<PaymentHistoryItemDto[]> {
    const rows = await this.paymentRepo.createQueryBuilder('p').innerJoinAndSelect('p.appointment','a')
      .leftJoinAndSelect('a.doctor','doctor').leftJoinAndSelect('doctor.department','department').leftJoinAndSelect('a.slot','slot')
      .where('a.user_id=:userId',{userId}).orderBy('p.created_at','DESC').skip((page-1)*pageSize).take(pageSize).getMany();
    return rows.map(p => ({ id:p.id, amount:Number(p.amount), paymentType:p.paymentType, paymentMethod:p.paymentMethod,
      status:p.status, createdAt:p.createdAt, payosOrderCode:p.payosOrderCode == null ? null : Number(p.payosOrderCode),
      appointment:p.appointment ? {id:p.appointment.id,status:p.appointment.status,slotTime:p.appointment.slot?.slotTime ?? null,
        doctor:p.appointment.doctor ? { fullName:p.appointment.doctor.fullName,avatarUrl:p.appointment.doctor.avatarUrl,
          departmentName:p.appointment.doctor.department?.name ?? null } : null } : null }));
  }

  async statusForPatient(userId: string, id: string) {
    const a=await this.appointmentRepo.findOne({where:{id,userId},relations:['doctor','slot']});
    if(!a) throw new NotFoundException('Không tìm thấy lịch khám');
    const p=await this.paymentRepo.findOne({where:{appointmentId:id}});
    return {id:a.id,status:a.status,doctorId:a.doctorId,doctorName:a.doctor?.fullName,slotTime:a.slot?.slotTime,
      paymentStatus:p?.status ?? null,checkoutUrl:a.status==='pending' ? p?.checkoutUrl : null,
      expiresAt:p?.expiresAt,amount:p ? Number(p.amount):null,reconciliationStatus:p?.reconciliationStatus};
  }

  async cancelByPatient(userId:string,id:string,reason?:string|null) { return this.cancel(userId,id,false,reason); }
  async cancelByAdmin(adminId:string,id:string,reason?:string|null) { return this.cancel(adminId,id,true,reason); }
  private async cancel(actorId:string,id:string,isAdmin:boolean,reason?:string|null) {
    const initial=await this.appointmentRepo.findOne({where:{id}});
    if(!initial) throw new NotFoundException('Không tìm thấy lịch khám');
    return this.dataSource.transaction(async em=>{
      await lockDoctor(em,initial.doctorId);
      const a=await em.findOneOrFail(AppointmentEntity,{where:{id},lock:{mode:'pessimistic_write'}});
      if(!isAdmin && a.userId!==actorId) throw new ForbiddenException('Lịch khám không thuộc bạn');
      if(a.status==='cancelled') return {id,status:a.status,depositRefunded:false};
      if(!['pending','confirmed'].includes(a.status)) throw new ConflictException('Không thể hủy lịch ở trạng thái hiện tại');
      const slot=a.slotId ? await em.findOne(AppointmentSlotEntity,{where:{id:a.slotId}}):null;
      if(!isAdmin && slot && new Date(slot.slotTime).getTime()<=Date.now()) throw new BadRequestException('Đã quá giờ khám');
      const clinicAvailable=await em.query("SELECT to_regclass('clinic_visits') AS name");
      if(clinicAvailable[0]?.name){
        const visits=await em.query('SELECT id,status FROM clinic_visits WHERE appointment_id=$1 FOR UPDATE',[id]);
        if(visits.some((v:{status:string})=>['in_consultation','completed'].includes(v.status)))
          throw new ConflictException('Ca đang khám hoặc đã hoàn tất; không thể hủy lịch');
        await em.query(`UPDATE clinic_visits SET status='cancelled',cancellation_reason=$2,version=version+1,updated_at=now()
          WHERE appointment_id=$1 AND status IN ('scheduled','checked_in')`,[id,reason?.trim().slice(0,1000)||'Hủy lịch trực tuyến']);
      }
      a.status=AppointmentStatus.Cancelled;a.cancelReason=reason?.trim().slice(0,1000)||null;a.cancelledAt=new Date();a.cancelledBy=actorId;
      await em.save(a);
      if(a.slotId) await em.query(`UPDATE appointment_slots SET status='available' WHERE id=$1 AND status='booked'
        AND NOT EXISTS(SELECT 1 FROM appointments WHERE slot_id=$1 AND status<>'cancelled')`,[a.slotId]);
      if(isAdmin) await em.query(`UPDATE payments SET reconciliation_status='needs_review',reconciliation_reason='clinic_cancelled'
        WHERE appointment_id=$1 AND status='paid'`,[id]);
      await em.query(`INSERT INTO operation_audit(actor_id,action,entity_id,detail) VALUES($1,'appointment.cancel',$2,$3)`,
        [actorId,id,JSON.stringify({reason:a.cancelReason,isAdmin})]);
      return {id,status:a.status,depositRefunded:false};
    });
  }

  async reschedule(userId:string,id:string,newSlotId:string,reason:string) {
    if(!reason?.trim()) throw new BadRequestException('Cần lý do đổi lịch');
    const initial=await this.appointmentRepo.findOne({where:{id,userId}});
    if(!initial) throw new NotFoundException('Không tìm thấy lịch khám');
    return this.dataSource.transaction(async em=>{
      await lockDoctor(em,initial.doctorId);
      await em.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`patient:${userId}`]);
      const a=await em.findOneOrFail(AppointmentEntity,{where:{id,userId},lock:{mode:'pessimistic_write'}});
      if(a.slotId===newSlotId) return {id,status:a.status};
      if(a.status!==AppointmentStatus.Confirmed) throw new ConflictException('Chỉ đổi lịch đã xác nhận');
      const old=await em.findOneOrFail(AppointmentSlotEntity,{where:{id:a.slotId!}});
      const next=await em.findOne(AppointmentSlotEntity,{where:{id:newSlotId},lock:{mode:'pessimistic_write'}});
      if(!next || next.doctorId!==a.doctorId || next.status!==SlotStatus.Available) throw new ConflictException('Ca mới không khả dụng của bác sĩ này');
      if(new Date(old.slotTime).getTime()<=Date.now() || new Date(next.slotTime).getTime()<=Date.now()) throw new ConflictException('Chỉ đổi lịch trong tương lai');
      await this.ensureDoctor(em,a.doctorId,new Date(next.slotTime));
      const collision=await em.query(`SELECT 1 FROM appointments a JOIN appointment_slots s ON s.id=a.slot_id WHERE a.user_id=$1
        AND a.id<>$2 AND a.status IN ('pending','confirmed') AND s.slot_time=$3`,[userId,id,next.slotTime]);
      if(collision.length) throw new ConflictException('Bạn đã có lịch ở thời điểm mới');
      // A registered visit follows the appointment until the patient checks in.
      const hasVisit=await em.query(`SELECT to_regclass('clinic_visits') AS name`);
      if(hasVisit[0]?.name) {
        const visits=await em.query(`SELECT id,status FROM clinic_visits WHERE appointment_id=$1 FOR UPDATE`,[id]);
        if(visits.some((v:{status:string})=>v.status!=='scheduled'))throw new ConflictException('Lịch đã tiếp đón hoặc kết thúc; liên hệ lễ tân để xử lý');
        await em.query('UPDATE clinic_visits SET scheduled_at=$2,version=version+1,updated_at=now() WHERE appointment_id=$1',
          [id,new Date(next.slotTime).toISOString()]);
      }
      next.status=SlotStatus.Booked;await em.save(next);a.slotId=next.id;await em.save(a);
      old.status=SlotStatus.Available;await em.save(old);
      await em.query(`DELETE FROM appointment_reminders WHERE appointment_id=$1`,[id]);
      await em.query(`INSERT INTO appointment_changes(appointment_id,actor_id,old_slot_id,new_slot_id,reason) VALUES($1,$2,$3,$4,$5)`,
        [id,userId,old.id,next.id,reason.trim().slice(0,1000)]);
      return {id,status:a.status};
    });
  }

  /** A valid payment event never reopens a cancelled or completed visit. */
  async markPaymentPaidByPayOSOrderCode(orderCode:number,amount?:number):Promise<void> {
    const initial=await this.paymentRepo.findOne({where:{payosOrderCode:orderCode}});
    if(!initial) throw new NotFoundException('Không tìm thấy giao dịch');
    const initialA=await this.appointmentRepo.findOneOrFail({where:{id:initial.appointmentId}});
    await this.dataSource.transaction(async em=>{
      await lockDoctor(em,initialA.doctorId);
      const a=await em.findOneOrFail(AppointmentEntity,{where:{id:initialA.id},lock:{mode:'pessimistic_write'}});
      const p=await em.findOneOrFail(PaymentEntity,{where:{id:initial.id},lock:{mode:'pessimistic_write'}});
      if(!Number.isSafeInteger(amount) || amount!==Number(p.amount)) {
        p.reconciliationStatus='needs_review';p.reconciliationReason='amount_mismatch';await em.save(p);return;
      }
      const wasPaid=p.status===PaymentStatus.Paid;
      if(wasPaid && p.reconciliationStatus==='resolved') return;
      p.status=PaymentStatus.Paid;
      const late=p.expiresAt && new Date(p.expiresAt).getTime()<=Date.now();
      if(a.status===AppointmentStatus.Pending && !late) {
        a.status=AppointmentStatus.Confirmed;await em.save(a);
        p.reconciliationStatus='clear';p.reconciliationReason=null;
      } else if(a.status===AppointmentStatus.Cancelled || (a.status===AppointmentStatus.Pending && late)) {
        p.reconciliationStatus='needs_review';p.reconciliationReason='late_or_cancelled_payment';
        if(a.status===AppointmentStatus.Pending) {
          a.status=AppointmentStatus.Cancelled;a.cancelReason='late_payment:chờ đối soát';a.cancelledAt=new Date();await em.save(a);
          if(a.slotId) await em.query(`UPDATE appointment_slots SET status='available' WHERE id=$1 AND status='booked'
            AND NOT EXISTS(SELECT 1 FROM appointments WHERE slot_id=$1 AND status<>'cancelled')`,[a.slotId]);
        }
      }
      await em.save(p);
      if(!wasPaid) await em.query(`INSERT INTO operation_audit(action,entity_id,detail) VALUES('payment.received',$1,$2)`,
        [p.id,JSON.stringify({orderCode,amount,reconciliation:p.reconciliationStatus})]);
    });
  }

  async releaseStalePendingBookings():Promise<{cancelled:number;slotsReleased:number}> {
    const candidates=await this.dataSource.query(`SELECT a.id,a.doctor_id FROM appointments a WHERE a.status='pending'
      AND COALESCE((SELECT MAX(p.expires_at) FROM payments p WHERE p.appointment_id=a.id),
        (a.created_at AT TIME ZONE current_setting('TimeZone'))+interval '5 minutes') <= now()
      ORDER BY a.doctor_id LIMIT 200`);
    let cancelled=0,slotsReleased=0;
    for(const c of candidates) await this.dataSource.transaction(async em=>{
      await lockDoctor(em,c.doctor_id);
      const a=await em.findOne(AppointmentEntity,{where:{id:c.id},lock:{mode:'pessimistic_write'}});
      if(!a || a.status!==AppointmentStatus.Pending) return;
      const remaining=await em.query('SELECT 1 FROM payments WHERE appointment_id=$1 AND expires_at>now()',[a.id]);
      if(remaining.length) return;
      const paid=await em.query(`SELECT 1 FROM payments WHERE appointment_id=$1 AND status='paid'`,[a.id]);
      if(paid.length) return;
      a.status=AppointmentStatus.Cancelled;a.cancelReason='auto-expired:chưa thanh toán';a.cancelledAt=new Date();await em.save(a);
      await em.query(`UPDATE payments SET status='failed' WHERE appointment_id=$1 AND status='pending'`,[a.id]);
      if(a.slotId){const rows=await em.query(`UPDATE appointment_slots SET status='available' WHERE id=$1 AND status='booked'
        AND NOT EXISTS(SELECT 1 FROM appointments WHERE slot_id=$1 AND status<>'cancelled') RETURNING id`,[a.slotId]);slotsReleased+=affectedCount(rows);}
      cancelled++;
    });
    return {cancelled,slotsReleased};
  }

  async reconcilePending():Promise<{checked:number}> {
    const rows=await this.paymentRepo.createQueryBuilder('p').where("p.payment_method='payos' AND p.payos_order_code IS NOT NULL")
      .andWhere("p.status<>'paid'").andWhere("COALESCE(p.expires_at,p.created_at AT TIME ZONE current_setting('TimeZone'))>now()-interval '7 days'")
      .andWhere("p.last_reconciled_at IS NULL OR p.last_reconciled_at<now()-interval '10 minutes'").orderBy('p.created_at','ASC').take(25).getMany();
    for(const p of rows){
      await this.dataSource.query('UPDATE payments SET last_reconciled_at=now() WHERE id=$1',[p.id]);
      try{const status=await this.payos.getPayment(Number(p.payosOrderCode));
        if(status?.status==='PAID') await this.markPaymentPaidByPayOSOrderCode(Number(p.payosOrderCode),status.amountPaid);
      }catch{this.logger.warn('Chưa đối soát được giao dịch; sẽ thử lại');}
    }
    return {checked:rows.length};
  }
  @Cron('0 * * * * *') async cronReleaseStaleBookings(){try{await this.releaseStalePendingBookings();}catch{this.logger.error('Không thu hồi được lịch chờ');}}
  @Cron('0 */10 * * * *') async cronReconcile(){if(this.payos.isConfigured())try{await this.reconcilePending();}catch{this.logger.error('Đối soát chưa hoàn tất');}}
  async purgeOrphanPastAvailableSlots():Promise<number>{const rows=await this.dataSource.query(`DELETE FROM appointment_slots s WHERE status='available'
    AND slot_time<(now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AND NOT EXISTS(SELECT 1 FROM appointments a WHERE a.slot_id=s.id)
    AND NOT EXISTS(SELECT 1 FROM clinic_visits v WHERE v.slot_id=s.id) RETURNING id`);return affectedCount(rows);}
  @Cron('0 0 3 * * *',{timeZone:'Asia/Ho_Chi_Minh'}) async cronPurgeOrphanPastAvailableSlots(){try{await this.purgeOrphanPastAvailableSlots();}catch{this.logger.error('Chưa dọn được ca trống');}}
}
