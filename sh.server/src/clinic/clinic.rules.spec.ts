import { assertVersion, assertVisitTransition, isoDate, money, requireRole, uuid, vitals } from './clinic.rules';

describe('clinic boundaries', () => {
  it('separates reception, financial and medical authority', () => {
    expect(() => requireRole({ id: 'fixture', role: 'user' }, ['cashier', 'admin'])).toThrow('Không có quyền');
    expect(() => requireRole({ id: 'fixture', role: 'receptionist' }, ['doctor'])).toThrow('Không có quyền');
    expect(() => requireRole({ id: 'fixture', role: 'cashier' }, ['cashier', 'admin'])).not.toThrow();
  });
  it('requires check-in before consultation and finalization is not a generic transition', () => {
    expect(() => assertVisitTransition('scheduled', 'in_consultation')).toThrow();
    expect(() => assertVisitTransition('checked_in', 'in_consultation')).not.toThrow();
    expect(() => assertVisitTransition('in_consultation', 'completed')).toThrow();
    expect(() => assertVisitTransition('completed', 'scheduled')).toThrow();
  });
  it('rejects fractional/negative/non-finite amounts and stale versions', () => {
    for (const value of [-1, 0, 0.5, Infinity, NaN, '50000']) expect(() => money(value)).toThrow();
    expect(money(50000)).toBe(50000);
    expect(money(0, 'fee', true)).toBe(0);
    expect(() => assertVersion(2, 1)).toThrow('Dữ liệu đã thay đổi');
  });
  it('validates real calendar dates, identifiers and allowlisted measurements', () => {
    expect(() => isoDate('2030-02-30', 'Ngày')).toThrow();
    expect(isoDate('2028-02-29', 'Ngày')).toBe('2028-02-29');
    expect(() => uuid('not-a-uuid', 'ID')).toThrow();
    expect(vitals({ temperature: 36.8, systolic: 120, oxygen: 99 })).toEqual({ temperature: 36.8, systolic: 120, oxygen: 99 });
    expect(() => vitals({ password: 123 })).toThrow();
    expect(() => vitals({ oxygen: 101 })).toThrow();
  });
});
