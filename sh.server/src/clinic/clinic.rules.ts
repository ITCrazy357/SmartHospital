import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

export type ClinicActor = { id: string; role: string };
export const STAFF_ROLES = ['admin', 'receptionist', 'doctor', 'cashier'];
export const VISIT_TRANSITIONS: Record<string, string[]> = {
  scheduled: ['checked_in', 'no_show', 'cancelled'],
  checked_in: ['in_consultation', 'no_show', 'cancelled'],
  in_consultation: [], completed: [], no_show: [], cancelled: [],
};
export function requireRole(actor: ClinicActor, roles: string[]) {
  if (!roles.includes(actor.role)) throw new ForbiddenException('Không có quyền thực hiện thao tác này');
}
export function text(value: unknown, field: string, max = 4000, required = false): string | null {
  if (value == null || value === '') {
    if (required) throw new BadRequestException(`${field} không được để trống`);
    return null;
  }
  if (typeof value !== 'string' || value.trim().length > max) throw new BadRequestException(`${field} không hợp lệ (tối đa ${max} ký tự)`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new BadRequestException(`${field} không được để trống`);
  return trimmed || null;
}
export function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException(`${field} phải là UUID hợp lệ`);
  return value;
}
export function money(value: unknown, field = 'Số tiền', allowZero = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 1_000_000_000) throw new BadRequestException(`${field} phải là số nguyên VND hợp lệ`);
  return value;
}
export function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new BadRequestException('Thiếu phiên bản dữ liệu');
  return value;
}
export function isoDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new BadRequestException(`${field} không hợp lệ`);
  return value;
}
export function assertVersion(actual: number, requested: number) {
  if (actual !== requested) throw new ConflictException('Dữ liệu đã thay đổi. Tải lại trước khi lưu.');
}
export function assertVisitTransition(current: string, next: string) {
  if (!VISIT_TRANSITIONS[current]?.includes(next)) throw new ConflictException('Không thể chuyển trạng thái ca khám');
}
export function vitals(input: unknown): Record<string, number> {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Chỉ số khám không hợp lệ');
  const ranges: Record<string, [number, number]> = { temperature: [25, 45], heartRate: [10, 300], systolic: [30, 300], diastolic: [10, 200], weight: [0.1, 500], height: [20, 300], oxygen: [1, 100] };
  const output: Record<string, number> = {};
  for (const [key, val] of Object.entries(input)) {
    if (!ranges[key] || typeof val !== 'number' || !Number.isFinite(val) || val < ranges[key][0] || val > ranges[key][1]) throw new BadRequestException(`Chỉ số ${key} không hợp lệ`);
    output[key] = val;
  }
  return output;
}
