-- =============================================================================
-- SmartHospital — DATABASE DESIGN (generated from sh.server/src/models)
-- =============================================================================
-- Mục đích:
--   - Import vào tool để generate ERD / database diagram
--   - Đồng bộ theo TypeORM entities trong `sh.server/src/models`
--
-- Target DB: PostgreSQL
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- pgvector cho RAG hồ sơ bệnh án (Phase 2). Image Postgres phải là pgvector/pgvector:pg16.
CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- ENUM types
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'slot_status') THEN
    CREATE TYPE slot_status AS ENUM ('available', 'booked', 'on_leave');
  END IF;
END
$$;
ALTER TYPE slot_status ADD VALUE IF NOT EXISTS 'on_leave';

-- -----------------------------------------------------------------------------
-- departments
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
  id          uuid PRIMARY KEY,
  name        varchar(255) NOT NULL,
  description text NULL
);

-- -----------------------------------------------------------------------------
-- users (patient / doctor / admin)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name              varchar(255) NOT NULL,
  email                  varchar(255) NOT NULL UNIQUE,
  phone                  varchar(50) NULL, -- unique thực tế: idx_users_phone_unique (WHERE phone IS NOT NULL)
  password_hash          text NOT NULL,
  role                   varchar(20) NOT NULL DEFAULT 'user',
  is_locked              boolean NOT NULL DEFAULT false,
  department_id          uuid NULL REFERENCES departments(id) ON DELETE SET NULL,
  bio                    text NULL,
  experience_years       integer NULL,
  university             varchar(255) NULL,
  avatar_url             text NULL,
  -- Pattern thời gian khám yêu thích — cache cho gợi ý lịch khám AI.
  -- jsonb: { hourSlots: number[], weekdays: number[], totalSamples: number, builtAt: string }
  preferred_time_pattern jsonb NULL,
  created_at             timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_department_id ON users(department_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- -----------------------------------------------------------------------------
-- password_reset_tokens (quên mật khẩu — role user)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  varchar(64) NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash_uq ON password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens (user_id);

-- -----------------------------------------------------------------------------
-- doctor_schedules (doctor_id -> users.id)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctor_schedules (
  id         uuid NOT NULL PRIMARY KEY,
  doctor_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_day   date NOT NULL,
  start_time time NOT NULL,
  end_time   time NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_doctor_schedules_doctor ON doctor_schedules(doctor_id);

-- -----------------------------------------------------------------------------
-- appointment_slots (slot 15 phút; chỉ T2–T6 theo CHECK)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointment_slots (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_time timestamp NOT NULL,
  status    slot_status NOT NULL DEFAULT 'available',
  CONSTRAINT appointment_slots_slot_weekday_only
    CHECK (EXTRACT(ISODOW FROM slot_time)::integer BETWEEN 1 AND 5)
);

CREATE INDEX IF NOT EXISTS idx_appointment_slots_doctor ON appointment_slots(doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointment_slots_time ON appointment_slots(slot_time);
CREATE INDEX IF NOT EXISTS idx_appointment_slots_status ON appointment_slots(status);

-- -----------------------------------------------------------------------------
-- appointments
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_id        uuid NULL REFERENCES appointment_slots(id) ON DELETE SET NULL,
  symptoms       text NULL,
  status         varchar(20) NOT NULL DEFAULT 'pending',
  deposit_amount numeric(10, 2) NULL,
  created_at     timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancel_reason  text NULL,
  cancelled_at   timestamptz NULL,
  cancelled_by   uuid NULL REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_appointments_user ON appointments(user_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON appointments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_slot ON appointments(slot_id);

-- Concurrency: 1 slot chỉ được gắn tối đa 1 appointment "đang sống" (chưa cancel).
-- Là chốt cứng ở DB, chặn race condition kể cả khi app layer có lỗi.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_appointments_active_slot
  ON appointments (slot_id)
  WHERE status <> 'cancelled' AND slot_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- appointment_reminders (track email nhắc lịch đã gửi — idempotency)
-- -----------------------------------------------------------------------------
-- kind: 'h24' (24h trước slot) | 'h1' (1h trước slot). PK composite chốt cứng:
-- mỗi (appointment, kind) chỉ tồn tại 1 row → cron chạy lặp không gửi mail trùng.
CREATE TABLE IF NOT EXISTS appointment_reminders (
  appointment_id  uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  kind            varchar(16) NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (appointment_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_appointment_reminders_kind ON appointment_reminders(kind);

COMMENT ON TABLE appointment_reminders IS
  'Track các email nhắc lịch đã gửi cho từng cuộc hẹn (idempotency).';

-- -----------------------------------------------------------------------------
-- payments
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id   uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  amount           numeric(10, 2) NOT NULL,
  payment_type     varchar(20) NULL,
  payment_method   varchar(50) NULL,
  status           varchar(20) NOT NULL DEFAULT 'pending',
  created_at       timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payos_order_code bigint NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_payments_appointment ON payments(appointment_id);

-- -----------------------------------------------------------------------------
-- doctor_leave_requests
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctor_leave_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  reason      text NULL,
  status      varchar(20) NOT NULL DEFAULT 'pending',
  reviewed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT doctor_leave_dates_order CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS idx_doctor_leave_doctor ON doctor_leave_requests(doctor_id);
CREATE INDEX IF NOT EXISTS idx_doctor_leave_status ON doctor_leave_requests(status);

COMMENT ON TABLE doctor_leave_requests IS
  'Bác sĩ xin nghỉ; admin duyệt → các slot available trong khoảng ngày (T2–T6) → on_leave';

-- -----------------------------------------------------------------------------
-- medical_records
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS medical_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appointment_id uuid NULL REFERENCES appointments(id) ON DELETE SET NULL,
  symptoms       text NULL,
  diagnosis      text NULL,
  treatment      text NULL,
  notes          text NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medical_records_patient ON medical_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_medical_records_doctor ON medical_records(doctor_id);
CREATE INDEX IF NOT EXISTS idx_medical_records_appointment ON medical_records(appointment_id);

-- -----------------------------------------------------------------------------
-- advertisements (PB38) + ENUMs liên quan
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ad_type') THEN
    CREATE TYPE ad_type AS ENUM ('banner', 'promo');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ad_status') THEN
    CREATE TYPE ad_status AS ENUM ('draft', 'active', 'paused', 'archived', 'expired');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ad_placement') THEN
    CREATE TYPE ad_placement AS ENUM (
      'home_hero',
      'home_below_search',
      'doctor_detail',
      'dashboard_user'
    );
  END IF;
END
$$;
ALTER TYPE ad_status ADD VALUE IF NOT EXISTS 'expired';

CREATE TABLE IF NOT EXISTS advertisements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type        ad_type        NOT NULL DEFAULT 'banner',
  title       varchar(255)   NOT NULL,
  body        text           NULL,
  image_url   text           NULL,
  link_url    text           NULL,
  placements  ad_placement[] NOT NULL DEFAULT '{}',
  status      ad_status      NOT NULL DEFAULT 'draft',
  priority    int            NOT NULL DEFAULT 0,
  start_at    timestamptz    NULL,
  end_at      timestamptz    NULL,
  view_count  int            NOT NULL DEFAULT 0,
  click_count int            NOT NULL DEFAULT 0,
  created_by  uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz    NOT NULL DEFAULT now(),
  updated_at  timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT advertisements_window_order
    CHECK (start_at IS NULL OR end_at IS NULL OR start_at < end_at),
  CONSTRAINT advertisements_title_nonempty CHECK (btrim(title) <> '')
);

CREATE INDEX IF NOT EXISTS idx_advertisements_status     ON advertisements(status);
CREATE INDEX IF NOT EXISTS idx_advertisements_window     ON advertisements(start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_advertisements_placements ON advertisements USING GIN (placements);

COMMENT ON TABLE advertisements IS
  'PB38: nội dung quảng cáo (banner/promo) hiển thị theo vị trí và lịch.';

-- -----------------------------------------------------------------------------
-- system_config (cấu hình hệ thống — admin điều chỉnh qua UI/API)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_config (
  key        varchar(100) PRIMARY KEY,
  value      text NOT NULL,
  updated_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Giá trị mặc định: tiền cọc đặt lịch 50,000 VND
INSERT INTO system_config (key, value)
VALUES ('deposit_amount', '50000')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE system_config IS
  'Cấu hình toàn hệ thống dạng key/value. Admin có thể cập nhật qua API PATCH /admin/config/:key.';

-- -----------------------------------------------------------------------------
-- ai_usage (log mỗi request OpenAI để theo dõi token & chi phí)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_usage (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature           varchar(64) NOT NULL,
  model             varchar(64) NOT NULL,
  prompt_tokens     integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens      integer NOT NULL DEFAULT 0,
  cost_usd          numeric(12, 6) NOT NULL DEFAULT 0,
  user_id           uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata          jsonb NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_feature ON ai_usage(feature);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at);

COMMENT ON TABLE ai_usage IS
  'Log mỗi request OpenAI (chat / embedding) → audit chi phí và truy vết.';

-- -----------------------------------------------------------------------------
-- ai_specialty_suggestions (cache kết quả AI gợi ý chuyên khoa theo triệu chứng)
-- -----------------------------------------------------------------------------
-- Cùng triệu chứng (sau khi normalize + hash) sẽ trả từ cache → không gọi OpenAI lần 2.
CREATE TABLE IF NOT EXISTS ai_specialty_suggestions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symptoms_hash   varchar(64) NOT NULL UNIQUE,
  symptoms_sample text NOT NULL,
  response_json   jsonb NOT NULL,
  hits            integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_specialty_suggestions_created ON ai_specialty_suggestions(created_at);

COMMENT ON TABLE ai_specialty_suggestions IS
  'Cache gợi ý chuyên khoa AI theo SHA-256 của triệu chứng (đã normalize).';

-- -----------------------------------------------------------------------------
-- medical_record_embeddings (vector embedding cho RAG trợ lý AI bác sĩ)
-- -----------------------------------------------------------------------------
-- 1 record → 1 row. Filter cứng `doctor_id` ở vector search → không leak hồ sơ
-- của bác sĩ khác. content_anonymized = text đã bóc PII trước khi embed.
CREATE TABLE IF NOT EXISTS medical_record_embeddings (
  record_id          uuid PRIMARY KEY REFERENCES medical_records(id) ON DELETE CASCADE,
  doctor_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_anonymized text NOT NULL,
  embedding          vector(1536) NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mre_doctor ON medical_record_embeddings(doctor_id);
CREATE INDEX IF NOT EXISTS idx_mre_patient ON medical_record_embeddings(patient_id);
-- HNSW dùng cosine — phù hợp với text-embedding-3-small (đã được L2-normalize).
CREATE INDEX IF NOT EXISTS idx_mre_embedding_hnsw
  ON medical_record_embeddings USING hnsw (embedding vector_cosine_ops);

COMMENT ON TABLE medical_record_embeddings IS
  'Vector embedding của medical_records (đã anonymize) phục vụ RAG cho trợ lý AI bác sĩ.';

-- -----------------------------------------------------------------------------
-- doctor_chat_sessions / doctor_chat_messages (lịch sử chat trợ lý AI)
-- -----------------------------------------------------------------------------
-- 1 bác sĩ có nhiều phiên hội thoại; 1 phiên có nhiều cặp (user, assistant) message.
-- sources (jsonb) lưu snapshot record-info dùng làm context — bác sĩ click "Xem hồ sơ" mở modal.
CREATE TABLE IF NOT EXISTS doctor_chat_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       varchar(200) NOT NULL DEFAULT 'Hội thoại mới',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dcs_doctor_updated
  ON doctor_chat_sessions(doctor_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS doctor_chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES doctor_chat_sessions(id) ON DELETE CASCADE,
  role        varchar(16) NOT NULL,
  content     text NOT NULL,
  sources     jsonb NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dcm_session_created
  ON doctor_chat_messages(session_id, created_at);

COMMENT ON TABLE doctor_chat_sessions IS
  'Phiên hội thoại bác sĩ ↔ trợ lý AI. updated_at = thời điểm có message mới nhất (sort sidebar).';
COMMENT ON TABLE doctor_chat_messages IS
  'Từng lượt nhắn trong phiên. role = user|assistant. sources (jsonb) chỉ ở assistant message.';
