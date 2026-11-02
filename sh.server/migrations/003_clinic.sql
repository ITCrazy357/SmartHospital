CREATE SEQUENCE IF NOT EXISTS clinic_patient_number_seq;
CREATE SEQUENCE IF NOT EXISTS clinic_queue_number_seq;

CREATE TABLE IF NOT EXISTS clinic_patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_code text NOT NULL UNIQUE DEFAULT ('BN-' || lpad(nextval('clinic_patient_number_seq')::text, 7, '0')),
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  full_name varchar(255) NOT NULL CHECK (btrim(full_name) <> ''),
  date_of_birth date,
  sex varchar(20) NOT NULL DEFAULT 'unspecified' CHECK (sex IN ('female','male','other','unspecified')),
  phone varchar(50), address text, allergies text, medical_history text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clinic_patients_name ON clinic_patients(lower(full_name));
CREATE TABLE IF NOT EXISTS clinic_patient_access (
  patient_id uuid NOT NULL REFERENCES clinic_patients(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  relationship varchar(40) NOT NULL,
  granted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(patient_id,user_id)
);
CREATE TABLE IF NOT EXISTS clinic_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES clinic_patients(id) ON DELETE RESTRICT,
  doctor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  appointment_id uuid UNIQUE REFERENCES appointments(id) ON DELETE RESTRICT,
  slot_id uuid REFERENCES appointment_slots(id) ON DELETE RESTRICT,
  scheduled_at timestamptz NOT NULL,
  source varchar(20) NOT NULL CHECK (source IN ('online','walk_in','phone')),
  status varchar(24) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','checked_in','in_consultation','completed','no_show','cancelled')),
  queue_number bigint NOT NULL DEFAULT nextval('clinic_queue_number_seq'),
  consultation_fee bigint NOT NULL CHECK (consultation_fee >= 0),
  symptoms text, cancellation_reason text,
  version integer NOT NULL DEFAULT 1,
  checked_in_at timestamptz, started_at timestamptz, completed_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clinic_visits_day_status ON clinic_visits(scheduled_at,status);
CREATE INDEX IF NOT EXISTS idx_clinic_visits_doctor ON clinic_visits(doctor_id,scheduled_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clinic_visits_active_slot ON clinic_visits(slot_id) WHERE slot_id IS NOT NULL AND status <> 'cancelled';
CREATE TABLE IF NOT EXISTS clinic_encounters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL UNIQUE REFERENCES clinic_visits(id) ON DELETE RESTRICT,
  status varchar(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
  vitals jsonb NOT NULL DEFAULT '{}'::jsonb,
  symptoms text, diagnosis text, treatment text, notes text,
  follow_up_date date,
  version integer NOT NULL DEFAULT 1,
  finalized_at timestamptz,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS clinic_encounter_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES clinic_encounters(id) ON DELETE RESTRICT,
  version integer NOT NULL, snapshot jsonb NOT NULL, reason text NOT NULL,
  changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(encounter_id,version)
);
CREATE TABLE IF NOT EXISTS clinic_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES clinic_visits(id) ON DELETE RESTRICT,
  kind varchar(24) NOT NULL CHECK (kind IN ('deposit','collection','refund','transfer_in','transfer_out')),
  amount bigint NOT NULL CHECK (amount <> 0),
  method varchar(24) NOT NULL, reference text, reason text,
  idempotency_key uuid NOT NULL UNIQUE,
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind IN ('refund','transfer_out') AND amount < 0) OR (kind IN ('deposit','collection','transfer_in') AND amount > 0))
);
CREATE INDEX IF NOT EXISTS idx_clinic_ledger_visit ON clinic_ledger(visit_id);
-- One actual online payment funds exactly one immutable ledger entry. This also
-- lets late/cancelled deposits enter the reviewed refund workflow without booking.
CREATE TABLE IF NOT EXISTS clinic_payment_links (
  payment_id uuid PRIMARY KEY REFERENCES payments(id) ON DELETE RESTRICT,
  visit_id uuid NOT NULL REFERENCES clinic_visits(id) ON DELETE RESTRICT,
  ledger_id uuid NOT NULL UNIQUE REFERENCES clinic_ledger(id) ON DELETE RESTRICT,
  credited_amount bigint NOT NULL CHECK (credited_amount > 0),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clinic_payment_links_visit ON clinic_payment_links(visit_id);
CREATE TABLE IF NOT EXISTS clinic_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), visit_id uuid NOT NULL REFERENCES clinic_visits(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL UNIQUE,
  amount bigint NOT NULL CHECK (amount > 0), reason text NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','paid')),
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  review_note text, payment_reference text,
  created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz, paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_clinic_refunds_status ON clinic_refunds(status,created_at);
CREATE TABLE IF NOT EXISTS clinic_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES clinic_patients(id) ON DELETE RESTRICT,
  doctor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  preferred_date date NOT NULL, note text,
  status varchar(16) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','offered','confirmed','cancelled')),
  offered_slot_id uuid REFERENCES appointment_slots(id) ON DELETE RESTRICT,
  offered_visit_id uuid REFERENCES clinic_visits(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clinic_waitlist_doctor ON clinic_waitlist(doctor_id,preferred_date,status);
CREATE TABLE IF NOT EXISTS clinic_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action varchar(80) NOT NULL, target_id uuid NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clinic_audit_target ON clinic_audit(target_id,created_at DESC);
CREATE TABLE IF NOT EXISTS clinic_operation_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind varchar(24) NOT NULL CHECK(kind IN ('reminder','reconciliation','visit','refund')),
  target_id uuid NOT NULL,
  assigned_to uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status varchar(16) NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','resolved')),
  note text, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kind,target_id)
);
CREATE INDEX IF NOT EXISTS idx_clinic_tasks_assignee ON clinic_operation_tasks(assigned_to,status);
