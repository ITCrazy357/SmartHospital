import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
import { PaymentStatus, PaymentType } from './enums';
import { AppointmentEntity } from './appointment.model';

/**
 * Model payments - bảng payments
 * amount: DECIMAL(10,2). payos_order_code: mã đơn PayOS để nhận webhook.
 */
export interface Payment {
  id: string;
  appointment_id: string;
  amount: number;
  payment_type: PaymentType | null;
  payment_method: string | null;
  status: PaymentStatus;
  created_at: Date;
  payos_order_code?: number | null;
}

@Entity('payments')
export class PaymentEntity {
  @Column({ name: 'checkout_url', type: 'text', nullable: true })
  checkoutUrl: string | null;

  @Column({ name: 'payment_link_id', type: 'text', nullable: true })
  paymentLinkId: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'reconciliation_status', type: 'varchar', default: 'clear' })
  reconciliationStatus: string;

  @Column({ name: 'reconciliation_reason', type: 'text', nullable: true })
  reconciliationReason: string | null;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'appointment_id', type: 'uuid' })
  appointmentId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ name: 'payment_type', type: 'varchar', length: 20, nullable: true })
  paymentType: PaymentType | null;

  @Column({ name: 'payment_method', type: 'varchar', length: 50, nullable: true })
  paymentMethod: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: PaymentStatus;

  @Column({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ name: 'payos_order_code', type: 'bigint', unique: true, nullable: true })
  payosOrderCode: number | null;

  @ManyToOne(() => AppointmentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'appointment_id' })
  appointment?: AppointmentEntity;
}
