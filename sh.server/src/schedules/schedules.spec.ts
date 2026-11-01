import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  addDays,
  buildSlotTimes,
  changedWeekdays,
  isoDate,
  todayVn,
  validateRules,
  type ScheduleRule,
} from './schedule.rules';
import { SchedulesService } from './schedules.service';
import { LeaveRequestsService } from '../leave-requests/leave-requests.service';
import { DoctorLeaveRequestEntity } from '../models/doctor-leave-request.model';
import { UserEntity } from '../models/user.model';

const monday: ScheduleRule = {
  weekday: 1,
  startTime: '08:00',
  endTime: '09:00',
  intervalMinutes: 15,
};

describe('schedule validation and hospital wall time', () => {
  it.each(['2026-02-30', '2026-99-10', 'not-a-date', '', null])(
    'rejects impossible date %s as 400',
    (date) => {
      expect(() => isoDate(date)).toThrow(BadRequestException);
    },
  );
  it('uses the Vietnam day at midnight and handles year/leap boundaries', () => {
    expect(todayVn(new Date('2026-11-01T18:00:00Z'))).toBe('2026-11-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('generates future weeks beyond the original 14-day horizon without weekends', () => {
    const slots = buildSlotTimes([monday], '2026-11-02', 30);
    expect(slots).toContain('2026-11-30 08:00:00');
    expect(slots).toHaveLength(5 * 4);
    expect(
      slots.every(
        (s) => new Date(`${s.slice(0, 10)}T12:00:00Z`).getUTCDay() === 1,
      ),
    ).toBe(true);
    expect(new Set(slots).size).toBe(slots.length);
  });
  it('keeps complete time intervals and excludes an interval that would end after the shift', () => {
    const slots = buildSlotTimes(
      [{ ...monday, intervalMinutes: 30 }],
      '2026-11-02',
      1,
    );
    expect(slots).toEqual(['2026-11-02 08:00:00', '2026-11-02 08:30:00']);
  });
  it.each([
    [{ ...monday, weekday: 6 }],
    [{ ...monday, intervalMinutes: 5 }],
    [{ ...monday, startTime: '25:00' }],
    [{ ...monday, endTime: '07:00' }],
    [{ ...monday, endTime: '09:10' }],
    [{ ...monday, startTime: '11:00', endTime: '14:00' }],
    [monday, { ...monday, startTime: '08:30', endTime: '09:30' }],
  ])('rejects invalid or overlapping rules %j', (...ruleList) => {
    expect(() => validateRules(ruleList)).toThrow(BadRequestException);
  });
  it('normalizes rules and identifies duration changes even with unchanged slot starts', () => {
    expect(validateRules([{ ...monday, weekday: 2 }, monday])).toEqual([
      monday,
      { ...monday, weekday: 2 },
    ]);
    expect(
      changedWeekdays([monday], [{ ...monday, intervalMinutes: 30 }]),
    ).toEqual([1]);
    expect(changedWeekdays([monday], [monday])).toEqual([]);
    expect(validateRules([])).toEqual([]);
  });
});

describe('schedule mutation boundaries', () => {
  function fixture(conflicts: unknown[] = []) {
    const events: string[] = [];
    const em = {
      query: jest.fn(async (sql: string) => {
        events.push(sql);
        if (sql.includes('SELECT id, is_locked FROM users'))
          return [{ id: 'doctor', is_locked: false }];
        if (sql.includes('FROM doctor_schedule_rules'))
          return [
            {
              weekday: 1,
              start_time: '08:00',
              end_time: '09:00',
              interval_minutes: 15,
            },
          ];
        if (sql.includes('FROM doctor_schedule_exceptions')) return [];
        if (sql.includes('AS "slotId"')) return conflicts;
        if (sql.includes('close_count')) return [{ close_count: 0 }];
        if (sql.includes('unnest') && sql.includes('AS count'))
          return [{ count: 0 }];
        return [];
      }),
    };
    const svc = new SchedulesService({ transaction: (fn) => fn(em) } as any);
    return { svc, em, events };
  }
  it('blocks a stale preview before deleting/changing rules', async () => {
    const { svc, events } = fixture();
    await expect(
      svc.saveRules('doctor', 'admin', {
        rules: [monday],
        confirm: true,
        expectedVersion: 'stale',
      }),
    ).rejects.toThrow(ConflictException);
    expect(
      events.some((q) => q.includes('DELETE FROM doctor_schedule_rules')),
    ).toBe(false);
  });
  it('rejects duration changes while a future booking exists on the changed weekday', async () => {
    const { svc, events } = fixture([
      { slotId: 'booked', slotTime: '2026-11-02 08:15:00' },
    ]);
    const plan = await svc.plan('doctor');
    await expect(
      svc.saveRules('doctor', 'admin', {
        rules: [{ ...monday, intervalMinutes: 30 }],
        confirm: true,
        expectedVersion: plan.version,
      }),
    ).rejects.toThrow(ConflictException);
    expect(
      events.some((q) => q.includes('DELETE FROM doctor_schedule_rules')),
    ).toBe(false);
  });
  it('requires explicit confirmation before changing work rules', async () => {
    const { svc, events } = fixture();
    const plan = await svc.plan('doctor');
    await expect(
      svc.saveRules('doctor', 'admin', {
        rules: [],
        expectedVersion: plan.version,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(
      events.some((q) => q.includes('DELETE FROM doctor_schedule_rules')),
    ).toBe(false);
  });
  it('serializes with booking before reading the plan and never updates booked slots', async () => {
    const { svc, events } = fixture();
    const plan = await svc.plan('doctor');
    events.length = 0;
    await svc.saveRules('doctor', 'admin', {
      rules: [monday],
      confirm: true,
      expectedVersion: plan.version,
    });
    expect(events[0]).toContain('pg_advisory_xact_lock');
    expect(
      events
        .filter((q) => q.startsWith('UPDATE appointment_slots'))
        .every((q) => /s\.status='(?:available|on_leave)'/.test(q)),
    ).toBe(true);
    expect(
      events.some((q) =>
        q.includes('ON CONFLICT(doctor_id,slot_time) DO NOTHING'),
      ),
    ).toBe(true);
    expect(events.some((q) => q.includes('INSERT INTO operation_audit'))).toBe(
      true,
    );
  });
});

describe('leave review shares the doctor lock with booking', () => {
  function fixture(booked: number, status = 'pending') {
    const events: string[] = [];
    const req = {
      id: 'leave',
      doctorId: 'doctor',
      startDate: '2026-11-02',
      endDate: '2026-11-03',
      status,
      createdAt: new Date(),
      reviewedAt: null,
      reason: null,
    };
    const qb: any = {};
    for (const method of ['where', 'andWhere', 'update', 'set'])
      qb[method] = jest.fn().mockReturnValue(qb);
    qb.getCount = jest.fn().mockResolvedValue(booked);
    qb.execute = jest.fn().mockResolvedValue({ affected: 1 });
    const em = {
      query: jest.fn(async (sql: string) => {
        events.push(sql);
        return [];
      }),
      findOne: jest.fn(async (entity: unknown) => {
        events.push(
          entity === DoctorLeaveRequestEntity ? 'lock-request' : 'read-doctor',
        );
        return entity === DoctorLeaveRequestEntity
          ? req
          : { id: 'doctor', fullName: 'Doctor', email: 'doctor@example.test' };
      }),
      getRepository: () => ({ createQueryBuilder: () => qb }),
      save: jest.fn(async (row) => row),
    };
    const svc = new LeaveRequestsService(
      { findOne: async () => req } as any,
      {} as any,
      {} as any,
      { transaction: (fn) => fn(em) } as any,
    );
    return { svc, em, qb, events };
  }
  it('refuses approving leave with a booked slot and does not update slots or the request', async () => {
    const { svc, em, qb, events } = fixture(1);
    await expect(svc.approve('leave', 'admin')).rejects.toThrow(
      ConflictException,
    );
    expect(events[0]).toContain('pg_advisory_xact_lock');
    expect(events[1]).toBe('lock-request');
    expect(qb.execute).not.toHaveBeenCalled();
    expect(em.save).not.toHaveBeenCalled();
  });
  it('rejects a stale approval/rejection after another reviewer changed the locked request', async () => {
    const { svc, em } = fixture(0, 'approved');
    await expect(svc.approve('leave', 'admin')).rejects.toThrow(
      BadRequestException,
    );
    await expect(svc.reject('leave', 'admin')).rejects.toThrow(
      BadRequestException,
    );
    expect(em.save).not.toHaveBeenCalled();
  });
  it('saves leave approval and slot closure with the same transaction manager', async () => {
    const { svc, em, qb } = fixture(0);
    const result = await svc.approve('leave', 'admin');
    expect(result.status).toBe('approved');
    expect(qb.execute).toHaveBeenCalledTimes(1);
    expect(em.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', reviewedBy: 'admin' }),
    );
  });
});
