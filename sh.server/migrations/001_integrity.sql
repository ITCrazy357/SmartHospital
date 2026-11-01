-- Never silently delete or merge existing clinical/financial data.
-- Resolve duplicate identities/records through an audited correction first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE phone IS NOT NULL GROUP BY phone HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate user phone values exist. Review and correct them before migrating.';
  END IF;
  IF EXISTS (SELECT 1 FROM medical_records WHERE appointment_id IS NOT NULL GROUP BY appointment_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate medical records for an appointment exist. Review them before migrating.';
  END IF;
  IF EXISTS (SELECT 1 FROM appointment_slots GROUP BY doctor_id, slot_time HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate doctor appointment slots exist. Review appointments and slots before migrating.';
  END IF;
END
$$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_time_pattern jsonb NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS university varchar(255) NULL;
ALTER TABLE users ALTER COLUMN university TYPE varchar(255) USING university::text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancel_reason text NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancelled_by uuid NULL REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payos_order_code bigint NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique ON users(phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_medical_records_appointment ON medical_records(appointment_id) WHERE appointment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_appointment_slots_doctor_time ON appointment_slots(doctor_id, slot_time);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payments_payos_order_code ON payments(payos_order_code) WHERE payos_order_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_user_created ON appointments(user_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_status ON appointments(doctor_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at DESC, id);
