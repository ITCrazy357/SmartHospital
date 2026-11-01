ALTER TABLE payments ADD COLUMN IF NOT EXISTS checkout_url text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_link_id text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reconciliation_status varchar(32) NOT NULL DEFAULT 'clear';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reconciliation_reason text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz;
UPDATE payments p SET expires_at = (a.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') + interval '5 minutes'
FROM appointments a WHERE p.appointment_id = a.id AND p.expires_at IS NULL AND p.status = 'pending';
CREATE INDEX IF NOT EXISTS idx_payments_reconcile ON payments(reconciliation_status, created_at);

CREATE TABLE IF NOT EXISTS appointment_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), appointment_id uuid NOT NULL REFERENCES appointments(id),
  actor_id uuid NOT NULL REFERENCES users(id), old_slot_id uuid REFERENCES appointment_slots(id),
  new_slot_id uuid REFERENCES appointment_slots(id), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS embedding_status varchar(20) NOT NULL DEFAULT 'pending';
CREATE TABLE IF NOT EXISTS medical_record_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), record_id uuid NOT NULL REFERENCES medical_records(id),
  version integer NOT NULL, actor_id uuid NOT NULL REFERENCES users(id), reason text NOT NULL,
  snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(record_id, version)
);

ALTER TABLE appointment_reminders ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'sent';
ALTER TABLE appointment_reminders ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE appointment_reminders ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE appointment_reminders ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE appointment_reminders ADD COLUMN IF NOT EXISTS last_error text;

CREATE TABLE IF NOT EXISTS doctor_schedule_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), doctor_id uuid NOT NULL REFERENCES users(id),
  weekday integer NOT NULL CHECK (weekday BETWEEN 1 AND 5), start_time time NOT NULL, end_time time NOT NULL,
  interval_minutes integer NOT NULL DEFAULT 15 CHECK (interval_minutes IN (10,15,20,30,60)),
  CHECK (start_time < end_time), UNIQUE(doctor_id, weekday, start_time)
);
INSERT INTO doctor_schedule_rules(doctor_id,weekday,start_time,end_time)
SELECT u.id, d.day, t.start_time::time, t.end_time::time FROM users u
CROSS JOIN generate_series(1,5) AS d(day)
CROSS JOIN (VALUES ('08:00','11:30'),('13:00','17:00')) AS t(start_time,end_time)
WHERE u.role='doctor' ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS doctor_schedule_exceptions (
  doctor_id uuid NOT NULL REFERENCES users(id), work_date date NOT NULL,
  closed boolean NOT NULL DEFAULT true, reason text NOT NULL,
  updated_by uuid NOT NULL REFERENCES users(id), PRIMARY KEY(doctor_id,work_date)
);
CREATE TABLE IF NOT EXISTS operation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES users(id),
  action varchar(80) NOT NULL, entity_id text NOT NULL, detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- External AI remains disabled until an operator enables the feature and the
-- organization approves its data-processing scope; per-user consent is separate.
INSERT INTO system_config(key,value) VALUES ('ai_enabled','false') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS ai_consents (
  user_id uuid PRIMARY KEY REFERENCES users(id), policy_version varchar(32) NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS request_limits (
  bucket varchar(160) PRIMARY KEY, count integer NOT NULL, resets_at timestamptz NOT NULL
);
