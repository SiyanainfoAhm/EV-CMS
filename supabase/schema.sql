-- EV CMS PostgreSQL schema (custom auth — no auth.users dependency)
-- All table names use EV_ prefix and double-quoted identifiers.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- SHA-256(password + salt) — used by login / password-change RPCs (Supabase: pgcrypto in extensions schema)
CREATE OR REPLACE FUNCTION public.ev_password_hash(p_password TEXT, p_salt TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT encode(digest(p_password || p_salt, 'sha256'::text), 'hex');
$$;

-- =============================================================================
-- ADMIN WEB: User management, roles, sessions, audit, tariffs, chargers ops
-- =============================================================================

COMMENT ON SCHEMA public IS 'EV CMS — admin web + mobile app shared database';

CREATE TABLE IF NOT EXISTS "EV_UserRoles" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "EV_UserRoles" IS 'Admin web: role definitions (SuperAdmin, SiteAdmin, Operator, Viewer)';

CREATE TABLE IF NOT EXISTS "EV_Users" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'Operator',
  status TEXT NOT NULL DEFAULT 'active',
  department TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ev_users_role_check CHECK (role IN ('SuperAdmin', 'SiteAdmin', 'Operator', 'Viewer')),
  CONSTRAINT ev_users_status_check CHECK (status IN ('active', 'inactive', 'suspended'))
);

COMMENT ON TABLE "EV_Users" IS 'Admin web + mobile: master user table for custom authentication';

CREATE INDEX IF NOT EXISTS idx_ev_users_status ON "EV_Users" (status);
CREATE INDEX IF NOT EXISTS idx_ev_users_created_at ON "EV_Users" (created_at);

CREATE TABLE IF NOT EXISTS "EV_UserSessions" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "EV_Users"(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  refresh_token_hash TEXT,
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "EV_UserSessions" IS 'Admin web + mobile: custom session tokens (not Supabase Auth)';

CREATE INDEX IF NOT EXISTS idx_ev_user_sessions_user_id ON "EV_UserSessions" (user_id);
CREATE INDEX IF NOT EXISTS idx_ev_user_sessions_created_at ON "EV_UserSessions" (created_at);

-- =============================================================================
-- SHARED: Chargers, connectors, OCPP events, meter values
-- =============================================================================

CREATE TABLE IF NOT EXISTS "EV_Chargers" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_point_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  firmware_version TEXT,
  charger_type TEXT NOT NULL,
  max_power_kw NUMERIC(10, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline',
  location TEXT,
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "EV_Chargers" IS 'Admin web: charger inventory; Mobile: nearby/available chargers';

CREATE INDEX IF NOT EXISTS idx_ev_chargers_status ON "EV_Chargers" (status);
CREATE INDEX IF NOT EXISTS idx_ev_chargers_created_at ON "EV_Chargers" (created_at);

CREATE TABLE IF NOT EXISTS "EV_ChargerConnectors" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  charger_id UUID NOT NULL REFERENCES "EV_Chargers"(id) ON DELETE CASCADE,
  connector_id INTEGER NOT NULL,
  connector_type TEXT NOT NULL,
  max_power_kw NUMERIC(10, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'Unavailable',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (charger_id, connector_id)
);

COMMENT ON TABLE "EV_ChargerConnectors" IS 'Admin web: connector management; Mobile: start/stop by connector';

CREATE INDEX IF NOT EXISTS idx_ev_charger_connectors_charger_id ON "EV_ChargerConnectors" (charger_id);
CREATE INDEX IF NOT EXISTS idx_ev_charger_connectors_status ON "EV_ChargerConnectors" (status);

CREATE TABLE IF NOT EXISTS "EV_ChargerEvents" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  charger_id UUID NOT NULL REFERENCES "EV_Chargers"(id) ON DELETE CASCADE,
  connector_id INTEGER,
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "EV_ChargerEvents" IS 'Admin web: OCPP/event log; gateway writes via API';

CREATE INDEX IF NOT EXISTS idx_ev_charger_events_charger_id ON "EV_ChargerEvents" (charger_id);
CREATE INDEX IF NOT EXISTS idx_ev_charger_events_created_at ON "EV_ChargerEvents" (created_at);

-- =============================================================================
-- MOBILE + ADMIN: Sessions, RFID, tariffs, payments
-- =============================================================================

CREATE TABLE IF NOT EXISTS "EV_RFIDCards" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES "EV_Users"(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'inactive',
  last_used_at TIMESTAMPTZ,
  total_sessions INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "EV_RFIDCards" IS 'Admin web: RFID management; Mobile: RFID binding';

CREATE INDEX IF NOT EXISTS idx_ev_rfid_cards_user_id ON "EV_RFIDCards" (user_id);
CREATE INDEX IF NOT EXISTS idx_ev_rfid_cards_status ON "EV_RFIDCards" (status);

CREATE TABLE IF NOT EXISTS "EV_Tariffs" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  rate_per_kwh NUMERIC(10, 2) NOT NULL,
  session_fee NUMERIC(10, 2) NOT NULL DEFAULT 0,
  gst_percent NUMERIC(5, 2) NOT NULL DEFAULT 18,
  applies_to TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  region TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "EV_Tariffs" IS 'Admin web: tariff configuration';

CREATE INDEX IF NOT EXISTS idx_ev_tariffs_status ON "EV_Tariffs" (is_active);
CREATE INDEX IF NOT EXISTS idx_ev_tariffs_created_at ON "EV_Tariffs" (created_at);

ALTER TABLE "EV_Chargers"
  ADD COLUMN IF NOT EXISTS tariff_id UUID REFERENCES "EV_Tariffs"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ev_chargers_tariff_id ON "EV_Chargers" (tariff_id);

CREATE TABLE IF NOT EXISTS "EV_ChargingSessions" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id INTEGER UNIQUE,
  charger_id UUID NOT NULL REFERENCES "EV_Chargers"(id),
  connector_id INTEGER NOT NULL,
  user_id UUID NOT NULL REFERENCES "EV_Users"(id),
  rfid_card_id UUID REFERENCES "EV_RFIDCards"(id),
  tariff_id UUID REFERENCES "EV_Tariffs"(id),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  energy_kwh NUMERIC(12, 3) DEFAULT 0,
  current_power_kw NUMERIC(10, 2),
  soc INTEGER,
  start_meter NUMERIC(12, 3),
  end_meter NUMERIC(12, 3),
  amount NUMERIC(12, 2),
  status TEXT NOT NULL DEFAULT 'active',
  stop_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "EV_ChargingSessions" IS 'Admin web: session monitoring; Mobile: live/history sessions';

CREATE INDEX IF NOT EXISTS idx_ev_charging_sessions_status ON "EV_ChargingSessions" (status);
CREATE INDEX IF NOT EXISTS idx_ev_charging_sessions_charger_id ON "EV_ChargingSessions" (charger_id);
CREATE INDEX IF NOT EXISTS idx_ev_charging_sessions_user_id ON "EV_ChargingSessions" (user_id);
CREATE INDEX IF NOT EXISTS idx_ev_charging_sessions_created_at ON "EV_ChargingSessions" (created_at);

CREATE TABLE IF NOT EXISTS "EV_MeterValues" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES "EV_ChargingSessions"(id) ON DELETE CASCADE,
  charger_id UUID NOT NULL REFERENCES "EV_Chargers"(id),
  connector_id INTEGER NOT NULL,
  sampled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  energy_kwh NUMERIC(12, 3),
  power_kw NUMERIC(10, 2),
  soc INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "EV_MeterValues" IS 'Admin web: metering charts; Mobile: live session progress';

CREATE INDEX IF NOT EXISTS idx_ev_meter_values_session_id ON "EV_MeterValues" (session_id);
CREATE INDEX IF NOT EXISTS idx_ev_meter_values_charger_id ON "EV_MeterValues" (charger_id);
CREATE INDEX IF NOT EXISTS idx_ev_meter_values_created_at ON "EV_MeterValues" (created_at);

CREATE TABLE IF NOT EXISTS "EV_Payments" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES "EV_ChargingSessions"(id),
  user_id UUID NOT NULL REFERENCES "EV_Users"(id),
  amount NUMERIC(12, 2) NOT NULL,
  gst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  gateway TEXT,
  gateway_txn_id TEXT,
  reconciliation_status TEXT DEFAULT 'unmatched',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "EV_Payments" IS 'Admin web: payment reconciliation; Mobile: payment history';

CREATE INDEX IF NOT EXISTS idx_ev_payments_status ON "EV_Payments" (status);
CREATE INDEX IF NOT EXISTS idx_ev_payments_session_id ON "EV_Payments" (session_id);
CREATE INDEX IF NOT EXISTS idx_ev_payments_user_id ON "EV_Payments" (user_id);
CREATE INDEX IF NOT EXISTS idx_ev_payments_created_at ON "EV_Payments" (created_at);

CREATE TABLE IF NOT EXISTS "EV_Receipts" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES "EV_Payments"(id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL UNIQUE,
  pdf_url TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "EV_Receipts" IS 'Mobile: receipts; Admin web: payment records';

CREATE INDEX IF NOT EXISTS idx_ev_receipts_payment_id ON "EV_Receipts" (payment_id);

-- =============================================================================
-- ADMIN WEB: Audit logs
-- =============================================================================

CREATE TABLE IF NOT EXISTS "EV_AuditLogs" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES "EV_Users"(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "EV_AuditLogs" IS 'Admin web: security and operations audit trail';

CREATE INDEX IF NOT EXISTS idx_ev_audit_logs_user_id ON "EV_AuditLogs" (user_id);
CREATE INDEX IF NOT EXISTS idx_ev_audit_logs_created_at ON "EV_AuditLogs" (created_at);

-- =============================================================================
-- MOBILE: Support tickets and notifications
-- =============================================================================

CREATE TABLE IF NOT EXISTS "EV_SupportTickets" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "EV_Users"(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  assigned_to UUID REFERENCES "EV_Users"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "EV_SupportTickets" IS 'Mobile: support/help; Admin web: ticket management (future)';

CREATE INDEX IF NOT EXISTS idx_ev_support_tickets_user_id ON "EV_SupportTickets" (user_id);
CREATE INDEX IF NOT EXISTS idx_ev_support_tickets_status ON "EV_SupportTickets" (status);
CREATE INDEX IF NOT EXISTS idx_ev_support_tickets_created_at ON "EV_SupportTickets" (created_at);

CREATE TABLE IF NOT EXISTS "EV_Notifications" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "EV_Users"(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "EV_Notifications" IS 'Mobile: push/in-app notifications; Admin web: alerts (future)';

CREATE INDEX IF NOT EXISTS idx_ev_notifications_user_id ON "EV_Notifications" (user_id);
CREATE INDEX IF NOT EXISTS idx_ev_notifications_created_at ON "EV_Notifications" (created_at);
