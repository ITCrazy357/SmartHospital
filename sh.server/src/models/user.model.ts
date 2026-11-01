/**
 * Model users - bảng users (user, doctor, admin)
 * Chuẩn từ db.sql. Gồm interface và class TypeORM.
 */
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
import { DepartmentEntity } from './department.model';

export type UserRole = 'user' | 'doctor' | 'admin' | 'receptionist' | 'cashier';

/** Pattern giờ khám yêu thích để hỗ trợ AI gợi ý lịch. */
export interface PreferredTimePattern {
  /** Top giờ khám hay đi nhất, vd [9, 10, 14] (giờ địa phương VN). */
  hourSlots: number[];
  /** Top thứ trong tuần hay đi nhất (0=CN, 1=T2, ..., 6=T7). */
  weekdays: number[];
  /** Số lần khám trong cửa sổ thống kê (≥3 mới đáng tin). */
  totalSamples: number;
  /** Thời điểm build pattern (ISO string). */
  builtAt: string;
}

/** Dạng trả về API (không có password), camelCase */
export interface UserPublic {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: UserRole;
  avatarUrl: string | null;
  /** Admin có thể khóa tài khoản (đặc biệt: bác sĩ). */
  isLocked?: boolean;
  /** Bổ sung cho admin / hồ sơ bác sĩ */
  departmentId?: string | null;
  bio?: string | null;
  experienceYears?: number | null;
  university?: string | null;
  createdAt?: string;
}

/** TypeORM entity mapping bảng users */
@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'full_name', type: 'varchar', length: 255 })
  fullName: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  /** SĐT chuẩn hóa (VN), unique khi có giá trị — khớp index idx_users_phone_unique */
  @Column({ type: 'varchar', length: 50, nullable: true, unique: true })
  phone: string | null;

  @Column({ name: 'password_hash', type: 'text', select: false })
  passwordHash: string;

  /** Incremented when credentials or account access change; never returned in public DTOs. */
  @Column({ name: 'token_version', type: 'integer', default: 0, select: false })
  tokenVersion: number;

  @Column({ type: 'varchar', length: 20, default: 'user' })
  role: UserRole;

  /** Khóa đăng nhập (admin). */
  @Column({ name: 'is_locked', type: 'boolean', default: false })
  isLocked: boolean;

  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ name: 'experience_years', type: 'int', nullable: true })
  experienceYears: number | null;

  /** Tên trường đại học (text tự nhập, chủ yếu cho bác sĩ) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  university: string | null;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl: string | null;

  /**
   * Pattern thời gian khám yêu thích — cache cho gợi ý lịch khám AI.
   * Lưu jsonb: { hourSlots: number[], weekdays: number[], totalSamples: number, builtAt: string }
   * Tính từ appointments hoàn thành/xác nhận trong N tháng gần nhất.
   * Null khi chưa đủ data (≥3 lịch).
   */
  @Column({ name: 'preferred_time_pattern', type: 'jsonb', nullable: true })
  preferredTimePattern: PreferredTimePattern | null;

  @Column({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @ManyToOne(() => DepartmentEntity, { nullable: true })
  @JoinColumn({ name: 'department_id' })
  department: DepartmentEntity | null;
}
