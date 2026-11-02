import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { isUuid } from './is-uuid';

const textFields = new Set([
  'name',
  'email',
  'fullName',
  'phone',
  'password',
  'confirmPassword',
  'currentPassword',
  'reason',
  'symptoms',
  'diagnosis',
  'treatment',
  'notes',
  'question',
  'title',
  'description',
  'returnUrl',
  'cancelUrl',
  'slotId',
  'appointmentId',
  'patientId',
  'doctorId',
  'departmentId',
  'sessionId',
  'startDate',
  'endDate',
  'workDate',
  'bio',
  'university',
  'role',
  'token',
]);
const fieldsByDto: Record<string, { allowed: string[]; required: string[] }> = {
  CreateBookingDto: {
    allowed: ['slotId', 'symptoms', 'returnUrl', 'cancelUrl'],
    required: ['slotId'],
  },
  CreateDepartmentDto: { allowed: ['name', 'description'], required: ['name'] },
  UpdateDepartmentDto: { allowed: ['name', 'description'], required: [] },
  CreateDoctorDto: {
    allowed: [
      'email',
      'password',
      'fullName',
      'phone',
      'departmentId',
      'bio',
      'experienceYears',
      'university',
    ],
    required: ['email', 'password', 'fullName'],
  },
};

/** Validate JSON shape before interface-based controllers dereference it.
 * Domain controllers/services retain their enum, format and business checks.
 */
@Injectable()
export class RequestValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.type !== 'body') return value;
    const body = value === undefined ? {} : value;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Nội dung yêu cầu phải là đối tượng');
    }
    this.inspect(body, 0);
    const definition = fieldsByDto[metadata.metatype?.name ?? ''];
    if (definition) {
      if (Object.keys(body).some((key) => !definition.allowed.includes(key))) {
        throw new BadRequestException('Yêu cầu có trường không được phép');
      }
      const fields = body as Record<string, unknown>;
      for (const key of definition.required) {
        if (
          typeof fields[key] !== 'string' ||
          !(fields[key] as string).trim()
        ) {
          throw new BadRequestException(`${key} không được để trống`);
        }
      }
      if (
        metadata.metatype?.name === 'UpdateDepartmentDto' &&
        'name' in fields &&
        (typeof fields.name !== 'string' || !fields.name.trim())
      ) {
        throw new BadRequestException('name không được để trống');
      }
      if (
        metadata.metatype?.name === 'CreateBookingDto' &&
        !isUuid(fields.slotId as string)
      ) {
        throw new BadRequestException('slotId phải là UUID hợp lệ');
      }
    }
    return body;
  }

  private inspect(value: unknown, depth: number): void {
    if (depth > 8) throw new BadRequestException('Dữ liệu lồng quá sâu');
    if (typeof value === 'string' && value.length > 20000)
      throw new BadRequestException('Nội dung quá dài');
    if (Array.isArray(value)) {
      if (value.length > 500)
        throw new BadRequestException('Danh sách quá dài');
      value.forEach((item) => this.inspect(item, depth + 1));
    } else if (value && typeof value === 'object') {
      for (const [key, field] of Object.entries(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key))
          throw new BadRequestException('Trường không hợp lệ');
        if (
          textFields.has(key) &&
          field !== null &&
          field !== undefined &&
          typeof field !== 'string'
        ) {
          throw new BadRequestException(`${key} phải là chuỗi`);
        }
        this.inspect(field, depth + 1);
      }
    }
  }
}
