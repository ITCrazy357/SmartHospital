import { BadRequestException } from '@nestjs/common';

export interface ScheduleRule {
  weekday: number;
  startTime: string;
  endTime: string;
  intervalMinutes: number;
}
export const SLOT_HORIZON_DAYS = 30;
const INTERVALS = [10, 15, 20, 30, 60];

export function isoDate(value: unknown, label = 'Ngày'): string {
  const date =
    typeof value === 'string' ? new Date(`${value}T12:00:00Z`) : new Date(NaN);
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`${label} phải là ngày hợp lệ YYYY-MM-DD`);
  }
  return value;
}

export function todayVn(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

export function addDays(date: string, offset: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

export function minutes(time: string): number {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

export function validateRules(input: unknown): ScheduleRule[] {
  if (!Array.isArray(input) || input.length > 30)
    throw new BadRequestException('rules phải là danh sách tối đa 30 ca');
  const rules = input
    .map((r): ScheduleRule => {
      if (
        !r ||
        typeof r !== 'object' ||
        !Number.isInteger(r.weekday) ||
        r.weekday < 1 ||
        r.weekday > 5 ||
        typeof r.startTime !== 'string' ||
        typeof r.endTime !== 'string' ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.startTime) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.endTime) ||
        !INTERVALS.includes(r.intervalMinutes)
      )
        throw new BadRequestException(
          'Ca làm việc không hợp lệ (T2–T6, HH:mm, bước 10/15/20/30/60 phút)',
        );
      const start = minutes(r.startTime),
        end = minutes(r.endTime);
      if (start >= end || (end - start) % r.intervalMinutes !== 0)
        throw new BadRequestException(
          'Ca phải đủ số khung giờ, thời gian bắt đầu trước kết thúc',
        );
      if (start < 13 * 60 && end > 11 * 60 + 30)
        throw new BadRequestException(
          'Tách ca để giữ giờ nghỉ trưa 11:30–13:00',
        );
      return {
        weekday: r.weekday,
        startTime: r.startTime,
        endTime: r.endTime,
        intervalMinutes: r.intervalMinutes,
      };
    })
    .sort(
      (a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime),
    );
  for (let i = 1; i < rules.length; i++) {
    if (
      rules[i - 1].weekday === rules[i].weekday &&
      rules[i - 1].endTime > rules[i].startTime
    ) {
      throw new BadRequestException(
        'Các ca trong cùng ngày không được chồng lấn',
      );
    }
  }
  return rules;
}

export function changedWeekdays(
  before: ScheduleRule[],
  after: ScheduleRule[],
): number[] {
  return [1, 2, 3, 4, 5].filter(
    (day) =>
      JSON.stringify(before.filter((r) => r.weekday === day)) !==
      JSON.stringify(after.filter((r) => r.weekday === day)),
  );
}

/** SQL timestamp strings are hospital wall time; never group these by the host timezone. */
export function buildSlotTimes(
  rules: ScheduleRule[],
  from: string,
  days = SLOT_HORIZON_DAYS,
): string[] {
  const result: string[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i),
      weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    for (const rule of rules.filter((r) => r.weekday === weekday)) {
      for (
        let m = minutes(rule.startTime);
        m + rule.intervalMinutes <= minutes(rule.endTime);
        m += rule.intervalMinutes
      ) {
        result.push(
          `${date} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`,
        );
      }
    }
  }
  return result;
}
