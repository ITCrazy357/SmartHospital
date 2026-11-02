import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { RequestValidationPipe } from './request-validation.pipe';
import { CreateBookingDto } from '../appointments/dto/create-booking.dto';
import {
  CreateDepartmentDto,
  UpdateDepartmentDto,
} from '../departments/dto/departments.dto';
import { CreateDoctorDto } from '../admin/dto/create-doctor.dto';

describe('request boundary validation', () => {
  const pipe = new RequestValidationPipe();
  const metadata = (metatype?: any): ArgumentMetadata => ({
    type: 'body',
    metatype,
  });
  it.each([null, 'text', 7, [], true])(
    'rejects non-object body %p before a controller uses it',
    (body) => {
      expect(() => pipe.transform(body, metadata())).toThrow(
        BadRequestException,
      );
    },
  );
  it.each([
    undefined,
    {},
    { name: null },
    { name: '' },
    { name: '   ' },
    { name: 42 },
  ])('rejects missing or invalid department name %p', (body) => {
    expect(() => pipe.transform(body, metadata(CreateDepartmentDto))).toThrow(
      BadRequestException,
    );
  });
  it('permits an optional description update but does not allow clearing a department name', () => {
    expect(
      pipe.transform({ description: null }, metadata(UpdateDepartmentDto)),
    ).toEqual({ description: null });
    expect(() =>
      pipe.transform({ name: null }, metadata(UpdateDepartmentDto)),
    ).toThrow(BadRequestException);
  });
  it('requires a booking identifier and rejects unknown DTO fields', () => {
    expect(() => pipe.transform({}, metadata(CreateBookingDto))).toThrow(
      BadRequestException,
    );
    expect(() =>
      pipe.transform({ slotId: 'not-a-uuid' }, metadata(CreateBookingDto)),
    ).toThrow(BadRequestException);
    expect(() =>
      pipe.transform(
        { slotId: '12222222-2222-4222-8222-222222222222', amount: 1 },
        metadata(CreateBookingDto),
      ),
    ).toThrow(BadRequestException);
  });
  it('requires doctor credentials without making optional profile fields mandatory', () => {
    expect(() =>
      pipe.transform(
        { email: 'fixture@example.invalid', password: 'Example123!' },
        metadata(CreateDoctorDto),
      ),
    ).toThrow(BadRequestException);
    const body = {
      email: 'fixture@example.invalid',
      password: 'Example123!',
      fullName: 'Fixture',
      departmentId: null,
    };
    expect(pipe.transform(body, metadata(CreateDoctorDto))).toBe(body);
  });
  it('rejects invalid scalar fields but retains structured vitals and rule arrays', () => {
    expect(() =>
      pipe.transform({ symptoms: { text: 'fixture' } }, metadata()),
    ).toThrow(BadRequestException);
    const body = {
      vitals: { heartRate: 70 },
      rules: [
        {
          weekday: 1,
          startTime: '08:00',
          endTime: '11:30',
          intervalMinutes: 15,
        },
      ],
    };
    expect(pipe.transform(body, metadata())).toBe(body);
  });
  it('rejects prototype keys and unbounded nesting/collections', () => {
    expect(() =>
      pipe.transform(JSON.parse('{"__proto__":{"polluted":true}}'), metadata()),
    ).toThrow(BadRequestException);
    expect(() =>
      pipe.transform({ entries: Array(501).fill(1) }, metadata()),
    ).toThrow(BadRequestException);
    let body: object = {};
    for (let i = 0; i < 10; i++) body = { nested: body };
    expect(() => pipe.transform(body, metadata())).toThrow(BadRequestException);
  });
  it('does not treat unrelated path/query arguments as body DTOs', () => {
    expect(pipe.transform('fixture', { type: 'param', metatype: String })).toBe(
      'fixture',
    );
  });
});
