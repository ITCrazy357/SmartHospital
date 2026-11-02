import { AppointmentRemindersService } from './appointment-reminders.service';

function fixture({ deliver = true, reserved = true, active = true } = {}) {
  const events: string[] = [];
  const query = jest.fn(async (sql: string) => {
    events.push(sql);
    if (sql.includes('FROM appointments a')) return [{ id: 'appointment', user_email: 'fixture@example.invalid', slot_time: new Date().toISOString() }];
    if (sql.includes('INSERT INTO appointment_reminders')) return reserved ? [{ appointment_id: 'appointment', attempts: 2 }] : [];
    if (sql.startsWith('SELECT 1 FROM appointments')) return active ? [{}] : [];
    return [];
  });
  const mail = { isConfigured: () => true, sendAppointmentReminderEmail: jest.fn(async () => {
    events.push('SMTP'); if (!deliver) throw new Error('fixture delivery failure');
  }) };
  const service = new AppointmentRemindersService({ query } as any, mail as any);
  return { service, query, mail, events };
}

describe('reminder lease and delivery', () => {
  it('marks sent only after delivery succeeds, using the claimed attempt token', async () => {
    const f = fixture();
    await f.service.runRemindersOnce();
    expect(f.mail.sendAppointmentReminderEmail).toHaveBeenCalledTimes(2);
    const markSent = f.events.findIndex(sql => sql.includes("status='sent',sent_at=now()"));
    expect(markSent).toBeGreaterThan(f.events.indexOf('SMTP'));
    expect(f.query.mock.calls.some(([sql]) => sql.includes('RETURNING appointment_id, attempts'))).toBe(true);
    expect(f.events[markSent]).toContain('attempts=$3');
  });
  it('retains failed delivery for retry instead of claiming it was sent', async () => {
    const f = fixture({ deliver: false });
    const result = await f.service.runRemindersOnce();
    expect(result.h24Failed).toBe(1); expect(result.h1Failed).toBe(1);
    expect(f.events.some(sql => sql.includes("status='sent',sent_at=now()"))).toBe(false);
    expect(f.events.some(sql => sql.includes("status='failed'") && sql.includes('next_attempt_at'))).toBe(true);
  });
  it('skips delivery when another worker still owns the reservation', async () => {
    const f = fixture({ reserved: false });
    await f.service.runRemindersOnce();
    expect(f.mail.sendAppointmentReminderEmail).not.toHaveBeenCalled();
    expect(f.events.some(sql => sql.includes('locked_until < now()'))).toBe(true);
  });
  it('marks an appointment canceled after selection as skipped, not sent', async () => {
    const f = fixture({ active: false });
    await f.service.runRemindersOnce();
    expect(f.mail.sendAppointmentReminderEmail).not.toHaveBeenCalled();
    expect(f.events.some(sql => sql.includes("status='skipped'"))).toBe(true);
  });
});
