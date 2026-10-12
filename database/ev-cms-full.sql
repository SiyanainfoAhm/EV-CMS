-- EV-CMS full database script
-- Schema, policies, functions, and seed data.
-- Run once in an empty PostgreSQL database or Supabase SQL Editor.
-- Seeded user password: dfccil123
-- Source files are listed at each section. This script does not connect to or change the hosted Supabase project.


-- =============================================================================
-- FILE: supabase/schema.sql
-- =============================================================================

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


-- =============================================================================
-- FILE: supabase/rls.sql
-- =============================================================================

-- Run after schema.sql — enables read access for anon key (demo).
-- Tighten policies before production; use service role on backend for writes.

ALTER TABLE "EV_UserRoles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_Users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_UserSessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_Chargers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_ChargerConnectors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_ChargerEvents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_RFIDCards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_Tariffs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_ChargingSessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_MeterValues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_Payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_Receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_AuditLogs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_SupportTickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_Notifications" ENABLE ROW LEVEL SECURITY;

-- Public read for CMS demo (no Supabase Auth)
DROP POLICY IF EXISTS "ev_anon_select_roles" ON "EV_UserRoles";
CREATE POLICY "ev_anon_select_roles" ON "EV_UserRoles" FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_select_chargers" ON "EV_Chargers";
CREATE POLICY "ev_anon_select_chargers" ON "EV_Chargers" FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_select_connectors" ON "EV_ChargerConnectors";
CREATE POLICY "ev_anon_select_connectors" ON "EV_ChargerConnectors" FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_select_events" ON "EV_ChargerEvents";
CREATE POLICY "ev_anon_select_events" ON "EV_ChargerEvents" FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_select_rfid" ON "EV_RFIDCards";
CREATE POLICY "ev_anon_select_rfid" ON "EV_RFIDCards" FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_select_tariffs" ON "EV_Tariffs";
CREATE POLICY "ev_anon_select_tariffs" ON "EV_Tariffs" FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_select_sessions" ON "EV_ChargingSessions";
CREATE POLICY "ev_anon_select_sessions" ON "EV_ChargingSessions" FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_select_meter" ON "EV_MeterValues";
CREATE POLICY "ev_anon_select_meter" ON "EV_MeterValues" FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_select_payments" ON "EV_Payments";
CREATE POLICY "ev_anon_select_payments" ON "EV_Payments" FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_select_receipts" ON "EV_Receipts";
CREATE POLICY "ev_anon_select_receipts" ON "EV_Receipts" FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_select_audit" ON "EV_AuditLogs";
CREATE POLICY "ev_anon_select_audit" ON "EV_AuditLogs" FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_select_tickets" ON "EV_SupportTickets";
CREATE POLICY "ev_anon_select_tickets" ON "EV_SupportTickets" FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_select_notifications" ON "EV_Notifications";
CREATE POLICY "ev_anon_select_notifications" ON "EV_Notifications" FOR SELECT TO anon, authenticated USING (true);

-- Users: no direct anon read (password_hash). Use verify_ev_login RPC.
DROP POLICY IF EXISTS "ev_deny_anon_users" ON "EV_Users";
CREATE POLICY "ev_deny_anon_users" ON "EV_Users" FOR SELECT TO anon USING (false);

DROP POLICY IF EXISTS "ev_auth_select_users" ON "EV_Users";
CREATE POLICY "ev_auth_select_users" ON "EV_Users" FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "ev_deny_anon_sessions_token" ON "EV_UserSessions";
CREATE POLICY "ev_deny_anon_sessions_token" ON "EV_UserSessions" FOR SELECT TO anon USING (false);

-- Custom login (email + password) — not Supabase Auth
DROP FUNCTION IF EXISTS verify_ev_login(TEXT, TEXT);
CREATE OR REPLACE FUNCTION verify_ev_login(p_email TEXT, p_password TEXT)
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  role TEXT,
  department TEXT,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.full_name,
    u.role,
    u.department,
    u.status
  FROM "EV_Users" u
  WHERE lower(u.email) = lower(trim(p_email))
    AND u.status = 'active'
    AND u.password_hash = ev_password_hash(p_password, u.salt);
END;
$$;

GRANT EXECUTE ON FUNCTION verify_ev_login(TEXT, TEXT) TO anon, authenticated;

-- List users for admin (no password fields) — safe public profile fields
CREATE OR REPLACE FUNCTION list_ev_users()
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  role TEXT,
  department TEXT,
  status TEXT,
  phone TEXT,
  avatar_url TEXT,
  employee_id TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  rfid_uid TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    u.email,
    u.full_name,
    u.role,
    u.department,
    u.status,
    u.phone,
    u.avatar_url,
    u.employee_id,
    u.last_login_at,
    u.created_at,
    r.uid AS rfid_uid
  FROM "EV_Users" u
  LEFT JOIN LATERAL (
    SELECT uid FROM "EV_RFIDCards" rf
    WHERE rf.user_id = u.id AND rf.status = 'active'
    ORDER BY rf.created_at DESC
    LIMIT 1
  ) r ON true
  ORDER BY u.full_name;
$$;

GRANT EXECUTE ON FUNCTION list_ev_users() TO anon, authenticated;


-- =============================================================================
-- FILE: supabase/policies_write.sql
-- =============================================================================

-- Run after rls.sql — enables admin CRUD from web app (anon key, demo only).
-- Production: move writes to a backend API using the service role.

-- Tariffs & RFID: direct table writes (safe to re-run)
DROP POLICY IF EXISTS "ev_anon_insert_tariffs" ON "EV_Tariffs";
CREATE POLICY "ev_anon_insert_tariffs" ON "EV_Tariffs" FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_update_tariffs" ON "EV_Tariffs";
CREATE POLICY "ev_anon_update_tariffs" ON "EV_Tariffs" FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_insert_rfid" ON "EV_RFIDCards";
CREATE POLICY "ev_anon_insert_rfid" ON "EV_RFIDCards" FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_update_rfid" ON "EV_RFIDCards";
CREATE POLICY "ev_anon_update_rfid" ON "EV_RFIDCards" FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Chargers: admin inventory CRUD (demo only — use service role API in production)
DROP POLICY IF EXISTS "ev_anon_insert_chargers" ON "EV_Chargers";
CREATE POLICY "ev_anon_insert_chargers" ON "EV_Chargers"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_update_chargers" ON "EV_Chargers";
CREATE POLICY "ev_anon_update_chargers" ON "EV_Chargers"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_insert_connectors" ON "EV_ChargerConnectors";
CREATE POLICY "ev_anon_insert_connectors" ON "EV_ChargerConnectors"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_update_connectors" ON "EV_ChargerConnectors";
CREATE POLICY "ev_anon_update_connectors" ON "EV_ChargerConnectors"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_delete_connectors" ON "EV_ChargerConnectors";
CREATE POLICY "ev_anon_delete_connectors" ON "EV_ChargerConnectors"
  FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_insert_events" ON "EV_ChargerEvents";
CREATE POLICY "ev_anon_insert_events" ON "EV_ChargerEvents"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Users: SECURITY DEFINER RPCs (no direct password exposure)
CREATE OR REPLACE FUNCTION create_ev_user(
  p_email TEXT,
  p_full_name TEXT,
  p_role TEXT,
  p_department TEXT DEFAULT 'Operations',
  p_joined_date DATE DEFAULT NULL,
  p_status TEXT DEFAULT 'active'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_db_role TEXT;
  v_status TEXT;
BEGIN
  v_db_role := CASE
    WHEN p_role IN ('Admin', 'SuperAdmin') THEN 'SuperAdmin'
    WHEN p_role = 'SiteAdmin' THEN 'SiteAdmin'
    WHEN p_role IN ('User', 'Operator', 'Viewer') THEN 'Operator'
    ELSE 'Operator'
  END;

  v_status := CASE
    WHEN lower(trim(COALESCE(p_status, ''))) = 'inactive' THEN 'inactive'
    ELSE 'active'
  END;

  INSERT INTO "EV_Users" (email, password_hash, salt, full_name, role, department, status, created_at)
  VALUES (
    lower(trim(p_email)),
    '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4',
    'ev_salt_2026',
    trim(p_full_name),
    v_db_role,
    COALESCE(NULLIF(trim(p_department), ''), 'Operations'),
    v_status,
    COALESCE(p_joined_date::timestamptz, NOW())
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION update_ev_user(
  p_id UUID,
  p_email TEXT,
  p_full_name TEXT,
  p_role TEXT,
  p_department TEXT,
  p_joined_date DATE DEFAULT NULL,
  p_status TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_db_role TEXT;
  v_status TEXT;
BEGIN
  v_db_role := CASE
    WHEN p_role IN ('Admin', 'SuperAdmin') THEN 'SuperAdmin'
    WHEN p_role = 'SiteAdmin' THEN 'SiteAdmin'
    WHEN p_role IN ('User', 'Operator', 'Viewer') THEN 'Operator'
    ELSE 'Operator'
  END;

  v_status := CASE
    WHEN lower(trim(COALESCE(p_status, ''))) = 'inactive' THEN 'inactive'
    WHEN lower(trim(COALESCE(p_status, ''))) = 'active' THEN 'active'
    ELSE NULL
  END;

  UPDATE "EV_Users"
  SET
    email = lower(trim(p_email)),
    full_name = trim(p_full_name),
    role = v_db_role,
    department = COALESCE(NULLIF(trim(p_department), ''), department),
    created_at = COALESCE(p_joined_date::timestamptz, created_at),
    status = COALESCE(v_status, status),
    updated_at = NOW()
  WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION set_ev_user_status(p_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE "EV_Users"
  SET status = p_status, updated_at = NOW()
  WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION delete_ev_user(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE "EV_Users" SET status = 'inactive', updated_at = NOW() WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_ev_user(TEXT, TEXT, TEXT, TEXT, DATE, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_ev_user(UUID, TEXT, TEXT, TEXT, TEXT, DATE, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_ev_user_status(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_ev_user(UUID) TO anon, authenticated;


-- =============================================================================
-- FILE: supabase/rfp_roles.sql
-- =============================================================================

-- RFP role alignment (run after schema.sql, before or with seed.sql)
-- RFP roles: SuperAdmin, SiteAdmin, User
-- DB stores User as Operator (legacy) or User when constraint allows.

ALTER TABLE "EV_Users" DROP CONSTRAINT IF EXISTS ev_users_role_check;

ALTER TABLE "EV_Users"
  ADD CONSTRAINT ev_users_role_check
  CHECK (role IN ('SuperAdmin', 'SiteAdmin', 'User', 'Operator', 'Viewer'));

COMMENT ON TABLE "EV_UserRoles" IS 'RFP: SuperAdmin, SiteAdmin, User (+ legacy Operator/Viewer)';

INSERT INTO "EV_UserRoles" (code, name, description) VALUES
  ('User', 'User', 'Mobile app — charge, sessions, RFID, payments'),
  ('Operator', 'User (legacy)', 'Legacy DB value; maps to RFP User in apps'),
  ('Viewer', 'User (legacy read-only)', 'Legacy DB value; maps to RFP User in apps')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

-- create_ev_user / update_ev_user: accept RFP role labels
CREATE OR REPLACE FUNCTION create_ev_user(
  p_email TEXT,
  p_full_name TEXT,
  p_role TEXT,
  p_department TEXT DEFAULT 'Operations'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_db_role TEXT;
BEGIN
  v_db_role := CASE
    WHEN p_role IN ('Admin', 'SuperAdmin') THEN 'SuperAdmin'
    WHEN p_role = 'SiteAdmin' THEN 'SiteAdmin'
    WHEN p_role IN ('User', 'Operator', 'Viewer') THEN 'Operator'
    ELSE 'Operator'
  END;

  INSERT INTO "EV_Users" (email, password_hash, salt, full_name, role, department, status)
  VALUES (
    lower(trim(p_email)),
    '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4',
    'ev_salt_2026',
    trim(p_full_name),
    v_db_role,
    COALESCE(NULLIF(trim(p_department), ''), 'Operations'),
    'active'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION update_ev_user(
  p_id UUID,
  p_email TEXT,
  p_full_name TEXT,
  p_role TEXT,
  p_department TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_db_role TEXT;
BEGIN
  v_db_role := CASE
    WHEN p_role IN ('Admin', 'SuperAdmin') THEN 'SuperAdmin'
    WHEN p_role = 'SiteAdmin' THEN 'SiteAdmin'
    WHEN p_role IN ('User', 'Operator', 'Viewer') THEN 'Operator'
    ELSE 'Operator'
  END;

  UPDATE "EV_Users"
  SET
    email = lower(trim(p_email)),
    full_name = trim(p_full_name),
    role = v_db_role,
    department = COALESCE(NULLIF(trim(p_department), ''), department),
    updated_at = NOW()
  WHERE id = p_id;
END;
$$;


-- =============================================================================
-- FILE: supabase/profile_and_storage.sql
-- =============================================================================

-- Run after policies_write.sql — profile fields, preferences, media path support.
-- Demo: anon can update own profile via SECURITY DEFINER RPCs.

ALTER TABLE "EV_Users"
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS employee_id TEXT;

CREATE TABLE IF NOT EXISTS "EV_UserPreferences" (
  user_id UUID PRIMARY KEY REFERENCES "EV_Users"(id) ON DELETE CASCADE,
  notifications JSONB NOT NULL DEFAULT '{
    "chargerOffline": true,
    "chargerFaulted": true,
    "sessionStarted": false,
    "sessionStopped": false,
    "paymentReceived": true,
    "firmwareAvailable": true,
    "weeklyReport": true,
    "emailDigest": false
  }'::jsonb,
  system_settings JSONB NOT NULL DEFAULT '{
    "sessionTimeout": 30,
    "autoRefreshInterval": 15,
    "dateFormat": "DD/MM/YYYY",
    "timeFormat": "24h",
    "energyUnit": "kWh",
    "currency": "INR"
  }'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "EV_UserPreferences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ev_anon_select_preferences" ON "EV_UserPreferences"
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "ev_anon_upsert_preferences" ON "EV_UserPreferences"
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Backfill employee IDs for existing users
UPDATE "EV_Users" u
SET employee_id = sub.emp_id
FROM (
  SELECT
    id,
    'DFCCIL-' || upper(left(COALESCE(department, 'OPS'), 3)) || '-' ||
    lpad((row_number() OVER (PARTITION BY COALESCE(department, 'OPS') ORDER BY created_at))::text, 3, '0') AS emp_id
  FROM "EV_Users"
) sub
WHERE u.id = sub.id AND u.employee_id IS NULL;

-- Extend login RPC return shape
DROP FUNCTION IF EXISTS verify_ev_login(TEXT, TEXT);

CREATE OR REPLACE FUNCTION verify_ev_login(p_email TEXT, p_password TEXT)
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  role TEXT,
  department TEXT,
  status TEXT,
  phone TEXT,
  avatar_url TEXT,
  employee_id TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_user "EV_Users"%ROWTYPE;
BEGIN
  SELECT * INTO v_user
  FROM "EV_Users" u
  WHERE lower(u.email) = lower(trim(p_email));

  IF NOT FOUND THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (NULL, 'login_failed', 'auth', lower(trim(p_email)), 'Unknown email');
    RETURN;
  END IF;

  IF v_user.status <> 'active' THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_user.id, 'login_failed', 'auth', v_user.id::text, 'Account is not active');
    RETURN;
  END IF;

  IF v_user.password_hash <> ev_password_hash(p_password, v_user.salt) THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_user.id, 'login_failed', 'auth', v_user.id::text, 'Invalid password');
    RETURN;
  END IF;

  UPDATE "EV_Users" u
  SET last_login_at = NOW(), updated_at = NOW()
  WHERE u.id = v_user.id;

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (v_user.id, 'login', 'auth', v_user.id::text, 'Successful login');

  RETURN QUERY
  SELECT
    v_user.id,
    v_user.email,
    v_user.full_name,
    v_user.role,
    v_user.department,
    v_user.status,
    v_user.phone,
    v_user.avatar_url,
    v_user.employee_id,
    NOW(),
    v_user.created_at;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_ev_login(TEXT, TEXT) TO anon, authenticated;

DROP FUNCTION IF EXISTS list_ev_users();

CREATE OR REPLACE FUNCTION list_ev_users()
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  role TEXT,
  department TEXT,
  status TEXT,
  phone TEXT,
  avatar_url TEXT,
  employee_id TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  rfid_uid TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    u.email,
    u.full_name,
    u.role,
    u.department,
    u.status,
    u.phone,
    u.avatar_url,
    u.employee_id,
    u.last_login_at,
    u.created_at,
    r.uid AS rfid_uid
  FROM "EV_Users" u
  LEFT JOIN LATERAL (
    SELECT uid FROM "EV_RFIDCards" rf
    WHERE rf.user_id = u.id AND rf.status = 'active'
    ORDER BY rf.created_at DESC
    LIMIT 1
  ) r ON true
  ORDER BY u.full_name;
$$;

GRANT EXECUTE ON FUNCTION list_ev_users() TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_ev_user_profile(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  role TEXT,
  department TEXT,
  status TEXT,
  phone TEXT,
  avatar_url TEXT,
  employee_id TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  notifications JSONB,
  system_settings JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO "EV_UserPreferences" (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.full_name,
    u.role,
    u.department,
    u.status,
    u.phone,
    u.avatar_url,
    u.employee_id,
    u.last_login_at,
    u.created_at,
    p.notifications,
    p.system_settings
  FROM "EV_Users" u
  LEFT JOIN "EV_UserPreferences" p ON p.user_id = u.id
  WHERE u.id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_ev_user_profile(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION update_ev_user_profile(
  p_user_id UUID,
  p_full_name TEXT,
  p_email TEXT,
  p_phone TEXT DEFAULT NULL,
  p_department TEXT DEFAULT NULL,
  p_avatar_url TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE "EV_Users"
  SET
    full_name = trim(p_full_name),
    email = lower(trim(p_email)),
    phone = NULLIF(trim(p_phone), ''),
    department = COALESCE(NULLIF(trim(p_department), ''), department),
    avatar_url = COALESCE(p_avatar_url, avatar_url),
    updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (p_user_id, 'update', 'user_profile', p_user_id::text, 'Profile updated');
END;
$$;

GRANT EXECUTE ON FUNCTION update_ev_user_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION upsert_ev_user_preferences(
  p_user_id UUID,
  p_notifications JSONB,
  p_system_settings JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO "EV_UserPreferences" (user_id, notifications, system_settings, updated_at)
  VALUES (p_user_id, p_notifications, p_system_settings, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    notifications = EXCLUDED.notifications,
    system_settings = EXCLUDED.system_settings,
    updated_at = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_ev_user_preferences(UUID, JSONB, JSONB) TO anon, authenticated;

CREATE OR REPLACE FUNCTION change_ev_user_password(
  p_user_id UUID,
  p_current_password TEXT,
  p_new_password TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_salt TEXT;
  v_hash TEXT;
BEGIN
  SELECT salt, password_hash INTO v_salt, v_hash
  FROM "EV_Users"
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_hash <> ev_password_hash(p_current_password, v_salt) THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (p_user_id, 'login_failed', 'auth', p_user_id::text, 'Password change — wrong current password');
    RETURN false;
  END IF;

  UPDATE "EV_Users"
  SET
    password_hash = ev_password_hash(p_new_password, v_salt),
    updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (p_user_id, 'update', 'auth', p_user_id::text, 'Password changed');

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION change_ev_user_password(UUID, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_ev_login_history(p_user_id UUID, p_limit INT DEFAULT 20)
RETURNS TABLE (
  id UUID,
  action TEXT,
  details TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, action, details, ip_address, created_at
  FROM "EV_AuditLogs"
  WHERE user_id = p_user_id
    AND entity_type = 'auth'
    AND action IN ('login', 'login_failed')
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION get_ev_login_history(UUID, INT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_ev_login_attempt(
  p_email TEXT,
  p_success BOOLEAN,
  p_details TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_action TEXT;
BEGIN
  v_action := CASE WHEN p_success THEN 'login' ELSE 'login_failed' END;

  SELECT id INTO v_user_id
  FROM "EV_Users"
  WHERE lower(email) = lower(trim(p_email))
  LIMIT 1;

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_user_id,
    v_action,
    'auth',
    COALESCE(v_user_id::text, lower(trim(p_email))),
    COALESCE(p_details, CASE WHEN p_success THEN 'Successful login' ELSE 'Failed login attempt' END)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_ev_login_attempt(TEXT, BOOLEAN, TEXT) TO anon, authenticated;

-- Supabase Storage: bucket ev-media, paths EV/{user_id}/...
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ev-media',
  'ev-media',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "ev_media_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'ev-media');

CREATE POLICY "ev_media_anon_upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'ev-media' AND (storage.foldername(name))[1] = 'EV');

CREATE POLICY "ev_media_anon_update" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'ev-media')
  WITH CHECK (bucket_id = 'ev-media');

CREATE POLICY "ev_media_anon_delete" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'ev-media');

-- Sample OCPP events for charger detail (first DC charger)
INSERT INTO "EV_ChargerEvents" (charger_id, connector_id, event_type, payload, created_at)
SELECT
  'b0000001-0000-4000-8000-000000000001'::uuid,
  v.connector_id,
  v.event_type,
  v.payload::jsonb,
  v.created_at
FROM (VALUES
  (NULL::int, 'BootNotification', '{"chargePointModel":"MP-30DC-DG","chargePointVendor":"MyPower"}', NOW() - INTERVAL '2 hours'),
  (NULL::int, 'BootNotification.conf', '{"status":"Accepted","interval":300}', NOW() - INTERVAL '2 hours' + INTERVAL '1 second'),
  (1, 'StatusNotification', '{"connectorId":1,"status":"Available","errorCode":"NoError"}', NOW() - INTERVAL '90 minutes'),
  (1, 'Heartbeat', '{}', NOW() - INTERVAL '30 minutes'),
  (1, 'Heartbeat.conf', '{"currentTime":"2026-06-01T10:35:16Z"}', NOW() - INTERVAL '30 minutes' + INTERVAL '1 second'),
  (1, 'Authorize', '{"idTag":"RFID-DFCCIL-001"}', NOW() - INTERVAL '20 minutes'),
  (1, 'StartTransaction', '{"connectorId":1,"meterStart":12500}', NOW() - INTERVAL '18 minutes'),
  (1, 'MeterValues', '{"connectorId":1,"transactionId":1001,"meterValue":[{"sampledValue":[{"value":"12780.5"}]}]}', NOW() - INTERVAL '10 minutes')
) AS v(connector_id, event_type, payload, created_at)
WHERE EXISTS (SELECT 1 FROM "EV_Chargers" WHERE id = 'b0000001-0000-4000-8000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM "EV_ChargerEvents" WHERE charger_id = 'b0000001-0000-4000-8000-000000000001' LIMIT 1);


-- =============================================================================
-- FILE: supabase/auth_activity.sql
-- =============================================================================

-- Run this in Supabase SQL Editor (fixes PGRST202: record_ev_login_attempt not found)
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.record_ev_login_attempt(
  p_email TEXT,
  p_success BOOLEAN,
  p_details TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_action TEXT;
BEGIN
  v_action := CASE WHEN p_success THEN 'login' ELSE 'login_failed' END;

  SELECT id INTO v_user_id
  FROM "EV_Users"
  WHERE lower(email) = lower(trim(p_email))
  LIMIT 1;

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_user_id,
    v_action,
    'auth',
    COALESCE(v_user_id::text, lower(trim(p_email))),
    COALESCE(p_details, CASE WHEN p_success THEN 'Successful login' ELSE 'Failed login attempt' END)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_ev_login_attempt(TEXT, BOOLEAN, TEXT) TO anon, authenticated;

-- Optional: refresh login RPC so failed attempts are logged without the client RPC
DROP FUNCTION IF EXISTS verify_ev_login(TEXT, TEXT);

CREATE OR REPLACE FUNCTION verify_ev_login(p_email TEXT, p_password TEXT)
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  role TEXT,
  department TEXT,
  status TEXT,
  phone TEXT,
  avatar_url TEXT,
  employee_id TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_user "EV_Users"%ROWTYPE;
BEGIN
  SELECT * INTO v_user
  FROM "EV_Users" u
  WHERE lower(u.email) = lower(trim(p_email));

  IF NOT FOUND THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (NULL, 'login_failed', 'auth', lower(trim(p_email)), 'Unknown email');
    RETURN;
  END IF;

  IF v_user.status <> 'active' THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_user.id, 'login_failed', 'auth', v_user.id::text, 'Account is not active');
    RETURN;
  END IF;

  IF v_user.password_hash <> ev_password_hash(p_password, v_user.salt) THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_user.id, 'login_failed', 'auth', v_user.id::text, 'Invalid password');
    RETURN;
  END IF;

  UPDATE "EV_Users" u
  SET last_login_at = NOW(), updated_at = NOW()
  WHERE u.id = v_user.id;

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (v_user.id, 'login', 'auth', v_user.id::text, 'Successful login');

  RETURN QUERY
  SELECT
    v_user.id,
    v_user.email,
    v_user.full_name,
    v_user.role,
    v_user.department,
    v_user.status,
    v_user.phone,
    v_user.avatar_url,
    v_user.employee_id,
    NOW(),
    v_user.created_at;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_ev_login(TEXT, TEXT) TO anon, authenticated;


-- =============================================================================
-- FILE: supabase/notifications.sql
-- =============================================================================

-- In-app notifications (run after schema.sql + rls.sql)
-- Web admin bell + mobile; integrates with simulator via ev_notify_* helpers

DROP POLICY IF EXISTS "ev_anon_insert_notifications" ON "EV_Notifications";
CREATE POLICY "ev_anon_insert_notifications" ON "EV_Notifications"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_update_notifications" ON "EV_Notifications";
CREATE POLICY "ev_anon_update_notifications" ON "EV_Notifications"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION ev_notify_user(
  p_user_id UUID,
  p_title TEXT,
  p_message TEXT,
  p_type TEXT DEFAULT 'info'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO "EV_Notifications" (user_id, title, message, type, read)
  VALUES (p_user_id, p_title, p_message, COALESCE(NULLIF(trim(p_type), ''), 'info'), false)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION ev_notify_admins(
  p_title TEXT,
  p_message TEXT,
  p_type TEXT DEFAULT 'info'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD;
  n INTEGER := 0;
BEGIN
  FOR r IN
    SELECT id FROM "EV_Users"
    WHERE status = 'active' AND role IN ('SuperAdmin', 'SiteAdmin')
  LOOP
    PERFORM ev_notify_user(r.id, p_title, p_message, p_type);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION ev_notify_user(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_notify_admins(TEXT, TEXT, TEXT) TO anon, authenticated;

-- Demo seed (safe re-run)
INSERT INTO "EV_Notifications" (user_id, title, message, type, read, created_at) VALUES
  ('a0000001-0000-4000-8000-000000000006', 'Charger fault detected', 'MP Fast Charger Station 3 (MP-DC-003) reported Faulted status.', 'alert', false, NOW() - INTERVAL '12 minutes'),
  ('a0000001-0000-4000-8000-000000000006', 'New session started', 'Rajesh Kumar started charging on MP-DC-001 Gun 1.', 'session', false, NOW() - INTERVAL '28 minutes'),
  ('a0000001-0000-4000-8000-000000000006', 'Payment reconciled', 'SBIePay transaction SBI-20260531-001 matched successfully.', 'success', true, NOW() - INTERVAL '2 hours'),
  ('a0000001-0000-4000-8000-000000000006', 'Charger offline', 'MP Slow Charger Bay 3 has not sent a heartbeat for 15+ minutes.', 'warning', true, NOW() - INTERVAL '5 hours'),
  ('a0000001-0000-4000-8000-000000000001', 'Charging started', 'Your session on MP Fast Charger Station 1 has begun.', 'success', false, NOW() - INTERVAL '15 minutes'),
  ('a0000001-0000-4000-8000-000000000001', 'Session reminder', 'Active session is still in progress. Open Live Session to monitor energy.', 'info', true, NOW() - INTERVAL '1 day');

-- Realtime: run supabase/enable_realtime.sql (or Dashboard → Database → Replication)


-- =============================================================================
-- FILE: supabase/operational_alerts.sql
-- =============================================================================

-- Phase 1 operational alerts — preference-aware admin notifications (web bell).
-- Run after notifications.sql and profile_and_storage.sql

-- Default notification prefs (matches EV_UserPreferences default in profile_and_storage.sql)
CREATE OR REPLACE FUNCTION ev_default_notifications()
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '{
    "chargerOffline": true,
    "chargerFaulted": true,
    "sessionStarted": false,
    "sessionStopped": false,
    "paymentReceived": true,
    "firmwareAvailable": true,
    "weeklyReport": true,
    "emailDigest": false
  }'::jsonb;
$$;

CREATE OR REPLACE FUNCTION ev_notification_pref_enabled(p_notifications JSONB, p_category TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  prefs JSONB;
  val TEXT;
BEGIN
  prefs := COALESCE(p_notifications, ev_default_notifications());
  val := prefs->>p_category;
  IF val IS NULL THEN
    RETURN COALESCE((ev_default_notifications()->>p_category)::boolean, false);
  END IF;
  RETURN val::boolean;
END;
$$;

CREATE OR REPLACE FUNCTION ev_notify_admins_if_enabled(
  p_category TEXT,
  p_title TEXT,
  p_message TEXT,
  p_type TEXT DEFAULT 'info'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  n INTEGER := 0;
  prefs JSONB;
BEGIN
  FOR r IN
    SELECT u.id, COALESCE(up.notifications, ev_default_notifications()) AS notifications
    FROM "EV_Users" u
    LEFT JOIN "EV_UserPreferences" up ON up.user_id = u.id
    WHERE u.status = 'active'
      AND u.role IN ('SuperAdmin', 'SiteAdmin')
  LOOP
    IF ev_notification_pref_enabled(r.notifications, p_category) THEN
      PERFORM ev_notify_user(r.id, p_title, p_message, COALESCE(NULLIF(trim(p_type), ''), 'info'));
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION ev_list_admins_for_notification(p_category TEXT)
RETURNS TABLE(user_id UUID, email TEXT, full_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.email, u.full_name
  FROM "EV_Users" u
  LEFT JOIN "EV_UserPreferences" up ON up.user_id = u.id
  WHERE u.status = 'active'
    AND u.role IN ('SuperAdmin', 'SiteAdmin')
    AND ev_notification_pref_enabled(COALESCE(up.notifications, ev_default_notifications()), p_category);
END;
$$;

GRANT EXECUTE ON FUNCTION ev_notify_admins_if_enabled(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_list_admins_for_notification(TEXT) TO anon, authenticated;

-- Charger status: offline / faulted
CREATE OR REPLACE FUNCTION ev_trg_charger_status_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'offline' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'offline') THEN
    PERFORM ev_notify_admins_if_enabled(
      'chargerOffline',
      'Charger offline',
      NEW.name || ' (' || NEW.charge_point_id || ') has lost connectivity.',
      'warning'
    );
  ELSIF NEW.status = 'faulted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'faulted') THEN
    PERFORM ev_notify_admins_if_enabled(
      'chargerFaulted',
      'Charger fault detected',
      NEW.name || ' (' || NEW.charge_point_id || ') reported a fault condition.',
      'alert'
    );
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status = 'online'
    AND OLD.status = 'offline' THEN
    PERFORM ev_notify_admins_if_enabled(
      'chargerOffline',
      'Charger back online',
      NEW.name || ' (' || NEW.charge_point_id || ') has reconnected and is online.',
      'success'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ev_charger_status_alert ON "EV_Chargers";
CREATE TRIGGER ev_charger_status_alert
  AFTER INSERT OR UPDATE OF status ON "EV_Chargers"
  FOR EACH ROW
  EXECUTE FUNCTION ev_trg_charger_status_alert();

-- Session started / stopped
CREATE OR REPLACE FUNCTION ev_trg_session_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name TEXT;
  v_charger_name TEXT;
  v_charge_point_id TEXT;
BEGIN
  SELECT c.name, c.charge_point_id INTO v_charger_name, v_charge_point_id
  FROM "EV_Chargers" c
  WHERE c.id = NEW.charger_id;

  SELECT u.full_name INTO v_user_name
  FROM "EV_Users" u
  WHERE u.id = NEW.user_id;

  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    PERFORM ev_notify_admins_if_enabled(
      'sessionStarted',
      'New session started',
      COALESCE(v_user_name, 'A user') || ' started charging on '
        || COALESCE(v_charger_name, 'charger') || ' (connector ' || NEW.connector_id::text || ').',
      'session'
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.status = 'completed' THEN
    PERFORM ev_notify_admins_if_enabled(
      'sessionStopped',
      'Session stopped',
      'Charging session ended on ' || COALESCE(v_charger_name, 'charger')
        || ' (' || COALESCE(v_charge_point_id, '') || ') for ' || COALESCE(v_user_name, 'user') || '.',
      'info'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ev_session_alert ON "EV_ChargingSessions";
CREATE TRIGGER ev_session_alert
  AFTER INSERT OR UPDATE OF status ON "EV_ChargingSessions"
  FOR EACH ROW
  EXECUTE FUNCTION ev_trg_session_alert();

-- Payment success / failure
CREATE OR REPLACE FUNCTION ev_trg_payment_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name TEXT;
  v_amount TEXT;
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT u.full_name INTO v_user_name FROM "EV_Users" u WHERE u.id = NEW.user_id;
  v_amount := '₹' || COALESCE(NEW.total_amount, 0)::text;

  IF NEW.status = 'success' THEN
    PERFORM ev_notify_admins_if_enabled(
      'paymentReceived',
      'Payment received',
      COALESCE(v_user_name, 'User') || ' — ' || v_amount
        || COALESCE(' (Txn: ' || NULLIF(NEW.gateway_txn_id, '') || ')', ''),
      'success'
    );
  ELSIF NEW.status = 'failed' THEN
    PERFORM ev_notify_admins_if_enabled(
      'paymentReceived',
      'Payment failed',
      COALESCE(v_user_name, 'User') || ' — payment failed for ' || v_amount || '.',
      'alert'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ev_payment_alert ON "EV_Payments";
CREATE TRIGGER ev_payment_alert
  AFTER UPDATE OF status ON "EV_Payments"
  FOR EACH ROW
  EXECUTE FUNCTION ev_trg_payment_alert();

-- Simulator: stop duplicate admin alerts (DB triggers handle web admins)
CREATE OR REPLACE FUNCTION ev_sim_set_charger_status(p_charger_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_db_status TEXT;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  v_db_status := CASE lower(trim(p_status))
    WHEN 'available' THEN 'online'
    WHEN 'charging' THEN 'online'
    WHEN 'preparing' THEN 'online'
    WHEN 'finishing' THEN 'online'
    WHEN 'faulted' THEN 'faulted'
    WHEN 'unavailable' THEN 'offline'
    WHEN 'offline' THEN 'offline'
    ELSE 'online'
  END;

  UPDATE "EV_Chargers"
  SET status = v_db_status, last_status_change_at = v_now, updated_at = v_now,
      last_heartbeat_at = CASE WHEN lower(trim(p_status)) = 'offline' THEN v_now - INTERVAL '20 minutes' ELSE NOW() END
  WHERE id = p_charger_id;

  UPDATE "EV_ChargerConnectors"
  SET status = p_status, updated_at = v_now
  WHERE charger_id = p_charger_id AND connector_id = 1;

  PERFORM ev_sim_log_event(p_charger_id, 1, 'StatusNotification', jsonb_build_object('status', p_status));
END;
$$;

CREATE OR REPLACE FUNCTION ev_sim_start_session(
  p_charger_id UUID,
  p_connector_id INTEGER,
  p_user_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
  v_tariff_id UUID;
  v_rfid_id UUID;
  v_txn INTEGER;
BEGIN
  v_tariff_id := ev_get_default_tariff_id();
  IF v_tariff_id IS NULL THEN
    SELECT id INTO v_tariff_id FROM "EV_Tariffs" WHERE is_active = true ORDER BY created_at DESC LIMIT 1;
  END IF;
  SELECT id INTO v_rfid_id
  FROM "EV_RFIDCards"
  WHERE user_id = p_user_id
    AND status = 'active'
    AND upper(uid) <> 'ADMIN-BYPASS'
    AND uid NOT ILIKE 'MOBILE-%'
  LIMIT 1;

  v_txn := (EXTRACT(EPOCH FROM NOW())::INTEGER % 2000000000);

  INSERT INTO "EV_ChargingSessions" (
    transaction_id, charger_id, connector_id, user_id, rfid_card_id, tariff_id,
    start_time, energy_kwh, current_power_kw, status, authorization_method
  ) VALUES (
    v_txn, p_charger_id, p_connector_id, p_user_id, v_rfid_id, v_tariff_id,
    NOW(), 0, 0, 'active',
    CASE WHEN v_rfid_id IS NULL THEN 'Mobile' ELSE 'RFID' END
  )
  RETURNING id INTO v_session_id;

  UPDATE "EV_ChargerConnectors"
  SET status = 'Charging', updated_at = NOW()
  WHERE charger_id = p_charger_id AND connector_id = p_connector_id;

  UPDATE "EV_Chargers"
  SET status = 'online', last_status_change_at = NOW(), last_heartbeat_at = NOW(), updated_at = NOW()
  WHERE id = p_charger_id;

  PERFORM ev_sim_log_event(p_charger_id, p_connector_id, 'Authorize', jsonb_build_object('userId', p_user_id));
  PERFORM ev_sim_log_event(p_charger_id, p_connector_id, 'StartTransaction', jsonb_build_object('sessionId', v_session_id));

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (p_user_id, 'Remote Start', 'Session', v_session_id::text, 'Simulator StartTransaction');

  PERFORM ev_notify_user(p_user_id, 'Charging started', 'Your session has begun on connector ' || p_connector_id::text, 'charging_started');

  UPDATE "EV_Notifications" n
  SET reference_type = 'charging_session', reference_id = v_session_id
  WHERE n.id = (
    SELECT id FROM "EV_Notifications"
    WHERE user_id = p_user_id AND type = 'charging_started'
    ORDER BY created_at DESC
    LIMIT 1
  );

  RETURN v_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION ev_sim_stop_session(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_bill RECORD;
  v_is_prepaid BOOLEAN := false;
  v_has_paid BOOLEAN := false;
BEGIN
  SELECT s.*
  INTO v_sess
  FROM "EV_ChargingSessions" s
  WHERE s.id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  v_is_prepaid :=
    lower(COALESCE(v_sess.payment_mode, '')) = 'prepaid'
    OR COALESCE(v_sess.prepaid_mode, '') IN ('amount', 'time')
    OR COALESCE(v_sess.prepaid_total_inr, 0) > 0
    OR lower(COALESCE(v_sess.payment_status, '')) = 'paid';

  SELECT EXISTS (
    SELECT 1
    FROM "EV_Payments" p
    WHERE p.session_id = p_session_id
      AND p.status IN ('success', 'paid')
  ) INTO v_has_paid;

  SELECT *
  INTO v_bill
  FROM ev_calculate_session_bill(COALESCE(v_sess.energy_kwh, 0), v_sess.tariff_id)
  LIMIT 1;

  IF v_is_prepaid OR v_has_paid THEN
    UPDATE "EV_ChargingSessions"
    SET
      status = 'completed',
      end_time = NOW(),
      amount = v_bill.amount,
      current_power_kw = 0,
      stop_reason = 'Local',
      payment_mode = COALESCE(payment_mode, 'prepaid'),
      payment_status = 'paid',
      amount_due = 0,
      settlement_status = COALESCE(settlement_status, 'settled'),
      settlement_amount = COALESCE(prepaid_total_inr, prepaid_amount, 0),
      updated_at = NOW()
    WHERE id = p_session_id;

    UPDATE "EV_Payments"
    SET
      payment_kind = COALESCE(payment_kind, 'prepaid'),
      updated_at = NOW()
    WHERE session_id = p_session_id
      AND status IN ('success', 'paid');

    PERFORM ev_sim_log_event(
      v_sess.charger_id, v_sess.connector_id, 'StopTransaction',
      jsonb_build_object('sessionId', p_session_id, 'prepaid', true, 'amount', COALESCE(v_sess.prepaid_total_inr, 0))
    );

    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_sess.user_id, 'Remote Stop', 'Session', p_session_id::text, 'Simulator StopTransaction (prepaid — no post-pay)');

    PERFORM ev_notify_user(
      v_sess.user_id,
      'Charging Completed',
      'Payment already received via prepaid plan.',
      'charging_stopped'
    );
  ELSE
    UPDATE "EV_ChargingSessions"
    SET
      status = 'completed',
      end_time = NOW(),
      amount = v_bill.amount,
      current_power_kw = 0,
      stop_reason = 'Local',
      payment_mode = COALESCE(payment_mode, 'postpaid'),
      payment_status = COALESCE(payment_status, 'pending'),
      amount_due = v_bill.total_amount,
      updated_at = NOW()
    WHERE id = p_session_id;

    INSERT INTO "EV_Payments" (session_id, user_id, amount, gst_amount, total_amount, status, gateway, reconciliation_status)
    VALUES (
      p_session_id, v_sess.user_id, v_bill.amount, v_bill.gst_amount, v_bill.total_amount,
      'pending', 'razorpay', 'unmatched'
    );

    PERFORM ev_sim_log_event(
      v_sess.charger_id, v_sess.connector_id, 'StopTransaction',
      jsonb_build_object('sessionId', p_session_id, 'amount', v_bill.total_amount)
    );

    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_sess.user_id, 'Remote Stop', 'Session', p_session_id::text, 'Simulator StopTransaction');

    PERFORM ev_notify_user(
      v_sess.user_id,
      'Charging completed',
      'Session finished. Pay ₹' || ROUND(v_bill.total_amount, 2)::text || ' to complete your session.',
      'charging_stopped'
    );
  END IF;

  UPDATE "EV_ChargerConnectors"
  SET status = 'Available', updated_at = NOW()
  WHERE charger_id = v_sess.charger_id AND connector_id = v_sess.connector_id;

  UPDATE "EV_Chargers"
  SET status = 'online', last_status_change_at = NOW(), last_heartbeat_at = NOW(), updated_at = NOW()
  WHERE id = v_sess.charger_id;

  UPDATE "EV_Notifications" n
  SET reference_type = 'charging_session', reference_id = p_session_id
  WHERE n.id = (
    SELECT id FROM "EV_Notifications"
    WHERE user_id = v_sess.user_id AND type = 'charging_stopped'
    ORDER BY created_at DESC
    LIMIT 1
  );
END;
$$;


-- =============================================================================
-- FILE: supabase/phase2_operations_alerts.sql
-- =============================================================================

-- Phase 2 operations & maintenance alerts
-- Run after operational_alerts.sql

-- Charger back online (uses chargerOffline preference)
CREATE OR REPLACE FUNCTION ev_trg_charger_status_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'offline' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'offline') THEN
    PERFORM ev_notify_admins_if_enabled(
      'chargerOffline',
      'Charger offline',
      NEW.name || ' (' || NEW.charge_point_id || ') has lost connectivity.',
      'warning'
    );
  ELSIF NEW.status = 'faulted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'faulted') THEN
    PERFORM ev_notify_admins_if_enabled(
      'chargerFaulted',
      'Charger fault detected',
      NEW.name || ' (' || NEW.charge_point_id || ') reported a fault condition.',
      'alert'
    );
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status = 'online'
    AND OLD.status = 'offline' THEN
    PERFORM ev_notify_admins_if_enabled(
      'chargerOffline',
      'Charger back online',
      NEW.name || ' (' || NEW.charge_point_id || ') has reconnected and is online.',
      'success'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Low wallet balance (mobile users) — fires when usable balance crosses below ₹100
CREATE OR REPLACE FUNCTION ev_trg_wallet_low_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold NUMERIC := 100;
  v_old_usable NUMERIC;
  v_new_usable NUMERIC;
BEGIN
  v_old_usable := COALESCE(OLD.balance_amount, 0) - COALESCE(OLD.hold_amount, 0);
  v_new_usable := COALESCE(NEW.balance_amount, 0) - COALESCE(NEW.hold_amount, 0);

  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  IF v_new_usable < v_threshold AND (TG_OP = 'INSERT' OR v_old_usable >= v_threshold) THEN
    PERFORM ev_notify_user(
      NEW.user_id,
      'Low wallet balance',
      'Your usable balance is ₹' || ROUND(v_new_usable, 2)::text
        || '. Top up at least ₹' || ROUND(v_threshold, 0)::text || ' to continue charging.',
      'wallet_low_balance'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ev_wallet_low_balance ON "EV_WalletAccounts";
CREATE TRIGGER ev_wallet_low_balance
  AFTER INSERT OR UPDATE OF balance_amount, hold_amount, status ON "EV_WalletAccounts"
  FOR EACH ROW
  EXECUTE FUNCTION ev_trg_wallet_low_balance();

-- Firmware OCPP events (sent from gateway via RPC)
CREATE OR REPLACE FUNCTION ev_notify_firmware_alert(
  p_charge_point_id TEXT,
  p_outcome TEXT,
  p_detail TEXT DEFAULT ''
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_charger RECORD;
  v_title TEXT;
  v_type TEXT;
  v_message TEXT;
BEGIN
  SELECT id, name, charge_point_id INTO v_charger
  FROM "EV_Chargers"
  WHERE upper(charge_point_id) = upper(trim(p_charge_point_id))
  LIMIT 1;

  IF NOT FOUND THEN
    v_message := upper(trim(p_charge_point_id)) || COALESCE(': ' || NULLIF(trim(p_detail), ''), '');
  ELSE
    v_message := v_charger.name || ' (' || v_charger.charge_point_id || ')'
      || COALESCE(' — ' || NULLIF(trim(p_detail), ''), '');
  END IF;

  IF lower(trim(p_outcome)) IN ('failed', 'fail', 'rejected', 'error') THEN
    v_title := 'Firmware update failed';
    v_type := 'alert';
  ELSIF lower(trim(p_outcome)) IN ('installed', 'complete', 'completed') THEN
    v_title := 'Firmware update installed';
    v_type := 'success';
  ELSE
    v_title := 'Firmware update sent';
    v_type := 'info';
  END IF;

  RETURN ev_notify_admins_if_enabled('firmwareAvailable', v_title, v_message, v_type);
END;
$$;

GRANT EXECUTE ON FUNCTION ev_notify_firmware_alert(TEXT, TEXT, TEXT) TO anon, authenticated;


-- =============================================================================
-- FILE: supabase/phase2_web_admin.sql
-- =============================================================================

-- Phase 2 web admin — run after schema.sql + policies_write.sql

-- Session auth method (RFID / Mobile / QR / Remote)
ALTER TABLE "EV_ChargingSessions"
  ADD COLUMN IF NOT EXISTS authorization_method TEXT;

COMMENT ON COLUMN "EV_ChargingSessions".authorization_method IS 'RFID | Mobile | QR | Remote | Admin';

-- Archive sessions older than 1 year (run via pg_cron or manual admin job)
CREATE OR REPLACE FUNCTION archive_ev_sessions_older_than_one_year()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ := NOW() - INTERVAL '1 year';
  v_count INTEGER;
BEGIN
  WITH moved AS (
    DELETE FROM "EV_ChargingSessions"
    WHERE status IN ('completed', 'stopped', 'faulted')
      AND COALESCE(end_time, start_time) < v_cutoff
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM moved;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION archive_ev_sessions_older_than_one_year IS 'Phase 2 data retention — removes session rows older than 1 year';

GRANT EXECUTE ON FUNCTION archive_ev_sessions_older_than_one_year() TO anon, authenticated;


-- =============================================================================
-- FILE: supabase/enable_realtime.sql
-- =============================================================================

-- Enable Supabase Realtime for EV-CMS tables (web bell, dashboard, mobile in-app).
-- Run after schema.sql. Safe to re-run (skips tables already in publication).

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'EV_Notifications',
    'EV_Chargers',
    'EV_ChargerConnectors',
    'EV_ChargingSessions',
    'EV_MeterValues',
    'EV_ChargerEvents',
    'EV_Payments'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    END IF;
  END LOOP;
END $$;

-- Required for postgres_changes filters (e.g. user_id=eq.<uuid>) on notifications.
ALTER TABLE "EV_Notifications" REPLICA IDENTITY FULL;


-- =============================================================================
-- FILE: supabase/charger_simulator.sql
-- =============================================================================

-- OCPP-ready charger simulator (run after schema.sql, rls.sql, policies_write.sql, notifications.sql)
-- Safe to re-run: policies use DROP IF EXISTS; functions use CREATE OR REPLACE.
-- Maps spec names to existing columns: charge_point_id=charger_code, name=charger_name, max_power_kw=power_rating

ALTER TABLE "EV_Chargers"
  ADD COLUMN IF NOT EXISTS is_simulated BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_status_change_at TIMESTAMPTZ;

ALTER TABLE "EV_ChargingSessions"
  ADD COLUMN IF NOT EXISTS authorization_method TEXT;

COMMENT ON COLUMN "EV_Chargers".is_simulated IS 'True when created/managed by OCPP simulator (no physical CP)';

-- Simulator write policies (demo anon key) — safe to re-run
DROP POLICY IF EXISTS "ev_anon_insert_sessions" ON "EV_ChargingSessions";
CREATE POLICY "ev_anon_insert_sessions" ON "EV_ChargingSessions"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_update_sessions" ON "EV_ChargingSessions";
CREATE POLICY "ev_anon_update_sessions" ON "EV_ChargingSessions"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_insert_meter" ON "EV_MeterValues";
CREATE POLICY "ev_anon_insert_meter" ON "EV_MeterValues"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_insert_events" ON "EV_ChargerEvents";
CREATE POLICY "ev_anon_insert_events" ON "EV_ChargerEvents"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_update_chargers" ON "EV_Chargers";
CREATE POLICY "ev_anon_update_chargers" ON "EV_Chargers"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_update_connectors" ON "EV_ChargerConnectors";
CREATE POLICY "ev_anon_update_connectors" ON "EV_ChargerConnectors"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_insert_chargers" ON "EV_Chargers";
CREATE POLICY "ev_anon_insert_chargers" ON "EV_Chargers"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_insert_connectors" ON "EV_ChargerConnectors";
CREATE POLICY "ev_anon_insert_connectors" ON "EV_ChargerConnectors"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_insert_payments" ON "EV_Payments";
CREATE POLICY "ev_anon_insert_payments" ON "EV_Payments"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_insert_audit" ON "EV_AuditLogs";
CREATE POLICY "ev_anon_insert_audit" ON "EV_AuditLogs"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE OR REPLACE FUNCTION ev_sim_log_event(
  p_charger_id UUID,
  p_connector_id INTEGER,
  p_event_type TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO "EV_ChargerEvents" (charger_id, connector_id, event_type, payload)
  VALUES (p_charger_id, p_connector_id, p_event_type, p_payload)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION ev_sim_create_demo_chargers()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i INTEGER;
  v_code TEXT;
  v_charger_id UUID;
  v_count INTEGER := 0;
BEGIN
  IF (SELECT COUNT(*) FROM "EV_Chargers" WHERE is_simulated = true) >= 12 THEN
    RETURN 0;
  END IF;

  FOR i IN 1..12 LOOP
    v_code := 'DFCCIL-DEL-' || lpad(i::text, 2, '0');
    IF EXISTS (SELECT 1 FROM "EV_Chargers" WHERE charge_point_id = v_code) THEN
      CONTINUE;
    END IF;

    INSERT INTO "EV_Chargers" (
      charge_point_id, name, manufacturer, model, charger_type, max_power_kw,
      status, location, last_heartbeat_at, last_status_change_at, is_simulated
    ) VALUES (
      v_code,
      'DFCCIL Sim Charger ' || lpad(i::text, 2, '0'),
      'EV Simulator',
      'SIM-60DC',
      'DC Fast',
      60,
      'online',
      'DFCCIL Yard, New Delhi (Sim)',
      NOW(),
      NOW(),
      true
    )
    RETURNING id INTO v_charger_id;

    INSERT INTO "EV_ChargerConnectors" (charger_id, connector_id, connector_type, max_power_kw, status)
    VALUES
      (v_charger_id, 1, 'CCS2', 30, 'Available'),
      (v_charger_id, 2, 'CCS2', 30, 'Available');

    PERFORM ev_sim_log_event(v_charger_id, NULL, 'BootNotification', jsonb_build_object('chargePointId', v_code));
    PERFORM ev_sim_log_event(v_charger_id, NULL, 'StatusNotification', jsonb_build_object('status', 'Available'));
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION ev_sim_heartbeat(p_charger_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_now TIMESTAMPTZ := NOW();
BEGIN
  UPDATE "EV_Chargers"
  SET last_heartbeat_at = v_now, updated_at = v_now,
      status = CASE WHEN status = 'offline' THEN 'online' ELSE status END
  WHERE id = p_charger_id;

  PERFORM ev_sim_log_event(p_charger_id, NULL, 'Heartbeat', jsonb_build_object('timestamp', v_now));
  RETURN v_now;
END;
$$;

CREATE OR REPLACE FUNCTION ev_sim_status_change(p_charger_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_db_status TEXT;
BEGIN
  v_db_status := CASE lower(trim(p_status))
    WHEN 'available' THEN 'online'
    WHEN 'charging' THEN 'online'
    WHEN 'preparing' THEN 'online'
    WHEN 'finishing' THEN 'online'
    WHEN 'faulted' THEN 'faulted'
    WHEN 'unavailable' THEN 'offline'
    WHEN 'offline' THEN 'offline'
    ELSE 'online'
  END;

  UPDATE "EV_Chargers"
  SET status = v_db_status, last_status_change_at = v_now, updated_at = v_now,
      last_heartbeat_at = CASE WHEN lower(trim(p_status)) = 'offline' THEN v_now - INTERVAL '20 minutes' ELSE NOW() END
  WHERE id = p_charger_id;

  UPDATE "EV_ChargerConnectors"
  SET status = p_status, updated_at = v_now
  WHERE charger_id = p_charger_id
    AND connector_id = 1;

  PERFORM ev_sim_log_event(p_charger_id, 1, 'StatusNotification', jsonb_build_object('status', p_status));
END;
$$;

CREATE OR REPLACE FUNCTION ev_sim_start_session(
  p_charger_id UUID,
  p_connector_id INTEGER,
  p_user_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
  v_txn INTEGER;
  v_tariff_id UUID;
  v_rfid_id UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM "EV_ChargingSessions"
    WHERE charger_id = p_charger_id AND connector_id = p_connector_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Connector already has an active session';
  END IF;

  SELECT ev_get_default_tariff_id() INTO v_tariff_id;
  IF v_tariff_id IS NULL THEN
    SELECT id INTO v_tariff_id FROM "EV_Tariffs" WHERE is_active = true ORDER BY created_at LIMIT 1;
  END IF;
  SELECT id INTO v_rfid_id
  FROM "EV_RFIDCards"
  WHERE user_id = p_user_id
    AND status = 'active'
    AND upper(uid) <> 'ADMIN-BYPASS'
    AND uid NOT ILIKE 'MOBILE-%'
  LIMIT 1;

  v_txn := (EXTRACT(EPOCH FROM NOW())::INTEGER % 2000000000);

  INSERT INTO "EV_ChargingSessions" (
    transaction_id, charger_id, connector_id, user_id, rfid_card_id, tariff_id,
    start_time, energy_kwh, current_power_kw, status, authorization_method
  ) VALUES (
    v_txn, p_charger_id, p_connector_id, p_user_id, v_rfid_id, v_tariff_id,
    NOW(), 0, 0, 'active',
    CASE WHEN v_rfid_id IS NULL THEN 'Mobile' ELSE 'RFID' END
  )
  RETURNING id INTO v_session_id;

  UPDATE "EV_ChargerConnectors"
  SET status = 'Charging', updated_at = NOW()
  WHERE charger_id = p_charger_id AND connector_id = p_connector_id;

  UPDATE "EV_Chargers"
  SET status = 'online', last_status_change_at = NOW(), last_heartbeat_at = NOW(), updated_at = NOW()
  WHERE id = p_charger_id;

  PERFORM ev_sim_log_event(p_charger_id, p_connector_id, 'Authorize', jsonb_build_object('userId', p_user_id));
  PERFORM ev_sim_log_event(p_charger_id, p_connector_id, 'StartTransaction', jsonb_build_object('sessionId', v_session_id));

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (p_user_id, 'Remote Start', 'Session', v_session_id::text, 'Simulator StartTransaction');

  PERFORM ev_notify_user(p_user_id, 'Charging started', 'Your session has begun on connector ' || p_connector_id::text, 'charging_started');

  UPDATE "EV_Notifications" n
  SET reference_type = 'charging_session', reference_id = v_session_id
  WHERE n.id = (
    SELECT id FROM "EV_Notifications"
    WHERE user_id = p_user_id AND type = 'charging_started'
    ORDER BY created_at DESC
    LIMIT 1
  );

  RETURN v_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION ev_sim_meter_value(p_session_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_delta NUMERIC;
  v_energy NUMERIC;
  v_power NUMERIC;
BEGIN
  SELECT * INTO v_sess FROM "EV_ChargingSessions" WHERE id = p_session_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active session';
  END IF;

  v_delta := (ARRAY[0.2, 0.4, 0.5, 0.8])[1 + floor(random() * 4)::int];
  v_energy := COALESCE(v_sess.energy_kwh, 0) + v_delta;
  v_power := 15 + floor(random() * 20)::int;

  INSERT INTO "EV_MeterValues" (session_id, charger_id, connector_id, sampled_at, energy_kwh, power_kw, soc)
  VALUES (p_session_id, v_sess.charger_id, v_sess.connector_id, NOW(), v_energy, v_power, LEAST(99, 20 + floor(v_energy)));

  UPDATE "EV_ChargingSessions"
  SET energy_kwh = v_energy, current_power_kw = v_power, updated_at = NOW()
  WHERE id = p_session_id;

  PERFORM ev_sim_log_event(v_sess.charger_id, v_sess.connector_id, 'MeterValues', jsonb_build_object('energyKwh', v_energy, 'powerKw', v_power));

  RETURN v_energy;
END;
$$;

CREATE OR REPLACE FUNCTION ev_sim_stop_session(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_bill RECORD;
  v_is_prepaid BOOLEAN := false;
  v_has_paid BOOLEAN := false;
BEGIN
  SELECT s.*
  INTO v_sess
  FROM "EV_ChargingSessions" s
  WHERE s.id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  v_is_prepaid :=
    lower(COALESCE(v_sess.payment_mode, '')) = 'prepaid'
    OR COALESCE(v_sess.prepaid_mode, '') IN ('amount', 'time')
    OR COALESCE(v_sess.prepaid_total_inr, 0) > 0
    OR lower(COALESCE(v_sess.payment_status, '')) = 'paid';

  SELECT EXISTS (
    SELECT 1
    FROM "EV_Payments" p
    WHERE p.session_id = p_session_id
      AND p.status IN ('success', 'paid')
  ) INTO v_has_paid;

  SELECT *
  INTO v_bill
  FROM ev_calculate_session_bill(COALESCE(v_sess.energy_kwh, 0), v_sess.tariff_id)
  LIMIT 1;

  IF v_is_prepaid OR v_has_paid THEN
    UPDATE "EV_ChargingSessions"
    SET
      status = 'completed',
      end_time = NOW(),
      amount = v_bill.amount,
      current_power_kw = 0,
      stop_reason = 'Local',
      payment_mode = COALESCE(payment_mode, 'prepaid'),
      payment_status = 'paid',
      amount_due = 0,
      settlement_status = COALESCE(settlement_status, 'settled'),
      settlement_amount = COALESCE(prepaid_total_inr, prepaid_amount, 0),
      updated_at = NOW()
    WHERE id = p_session_id;

    UPDATE "EV_Payments"
    SET
      payment_kind = COALESCE(payment_kind, 'prepaid'),
      updated_at = NOW()
    WHERE session_id = p_session_id
      AND status IN ('success', 'paid');

    PERFORM ev_sim_log_event(
      v_sess.charger_id, v_sess.connector_id, 'StopTransaction',
      jsonb_build_object('sessionId', p_session_id, 'prepaid', true, 'amount', COALESCE(v_sess.prepaid_total_inr, 0))
    );

    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_sess.user_id, 'Remote Stop', 'Session', p_session_id::text, 'Simulator StopTransaction (prepaid — no post-pay)');

    PERFORM ev_notify_user(
      v_sess.user_id,
      'Charging Completed',
      'Payment already received via prepaid plan.',
      'charging_stopped'
    );
  ELSE
    UPDATE "EV_ChargingSessions"
    SET
      status = 'completed',
      end_time = NOW(),
      amount = v_bill.amount,
      current_power_kw = 0,
      stop_reason = 'Local',
      payment_mode = COALESCE(payment_mode, 'postpaid'),
      payment_status = COALESCE(payment_status, 'pending'),
      amount_due = v_bill.total_amount,
      updated_at = NOW()
    WHERE id = p_session_id;

    INSERT INTO "EV_Payments" (session_id, user_id, amount, gst_amount, total_amount, status, gateway, reconciliation_status)
    VALUES (
      p_session_id, v_sess.user_id, v_bill.amount, v_bill.gst_amount, v_bill.total_amount,
      'pending', 'razorpay', 'unmatched'
    );

    PERFORM ev_sim_log_event(
      v_sess.charger_id, v_sess.connector_id, 'StopTransaction',
      jsonb_build_object('sessionId', p_session_id, 'amount', v_bill.total_amount)
    );

    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_sess.user_id, 'Remote Stop', 'Session', p_session_id::text, 'Simulator StopTransaction');

    PERFORM ev_notify_user(
      v_sess.user_id,
      'Charging completed',
      'Session finished. Pay ₹' || ROUND(v_bill.total_amount, 2)::text || ' to complete your session.',
      'charging_stopped'
    );
  END IF;

  UPDATE "EV_ChargerConnectors"
  SET status = 'Available', updated_at = NOW()
  WHERE charger_id = v_sess.charger_id AND connector_id = v_sess.connector_id;

  UPDATE "EV_Chargers"
  SET status = 'online', last_status_change_at = NOW(), last_heartbeat_at = NOW(), updated_at = NOW()
  WHERE id = v_sess.charger_id;

  UPDATE "EV_Notifications" n
  SET reference_type = 'charging_session', reference_id = p_session_id
  WHERE n.id = (
    SELECT id FROM "EV_Notifications"
    WHERE user_id = v_sess.user_id AND type = 'charging_stopped'
    ORDER BY created_at DESC
    LIMIT 1
  );
END;
$$;

CREATE OR REPLACE FUNCTION ev_sim_heartbeat_all()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD; n INTEGER := 0;
BEGIN
  FOR r IN SELECT id FROM "EV_Chargers" WHERE is_simulated = true LOOP
    PERFORM ev_sim_heartbeat(r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION ev_sim_meter_all_active()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD; n INTEGER := 0;
BEGIN
  FOR r IN SELECT id FROM "EV_ChargingSessions" WHERE status = 'active' LOOP
    PERFORM ev_sim_meter_value(r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION ev_sim_create_demo_chargers() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_sim_heartbeat(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_sim_status_change(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_sim_start_session(UUID, INTEGER, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_sim_meter_value(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_sim_stop_session(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_sim_heartbeat_all() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_sim_meter_all_active() TO anon, authenticated;

-- Enable Realtime (Supabase Dashboard → Database → Replication, or run if publication exists):
-- ALTER PUBLICATION supabase_realtime ADD TABLE "EV_Chargers";
-- ALTER PUBLICATION supabase_realtime ADD TABLE "EV_ChargingSessions";
-- ALTER PUBLICATION supabase_realtime ADD TABLE "EV_MeterValues";
-- ALTER PUBLICATION supabase_realtime ADD TABLE "EV_ChargerEvents";
-- ALTER PUBLICATION supabase_realtime ADD TABLE "EV_Notifications";


-- =============================================================================
-- FILE: supabase/payments_admin.sql
-- =============================================================================

-- Admin web: payment verify, reconcile, receipt insert (demo anon key).
-- Production: use service role API or Edge Function webhooks.

DROP POLICY IF EXISTS "ev_anon_update_payments" ON "EV_Payments";
CREATE POLICY "ev_anon_update_payments" ON "EV_Payments"
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_insert_receipts" ON "EV_Receipts";
CREATE POLICY "ev_anon_insert_receipts" ON "EV_Receipts"
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);


-- =============================================================================
-- FILE: supabase/migrations/create_wallet_topup_tables.sql
-- =============================================================================

-- EV CMS Wallet & Top-up schema (prepaid wallet readiness — no gateway credit from mobile).
-- References EV_Users (custom auth — not auth.users).
-- Run in Supabase SQL Editor or via: supabase db push

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "EV_WalletAccounts" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "EV_Users"(id) ON DELETE CASCADE,
  balance_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  hold_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ev_wallet_accounts_user_unique UNIQUE (user_id),
  CONSTRAINT ev_wallet_accounts_balance_nonneg CHECK (balance_amount >= 0),
  CONSTRAINT ev_wallet_accounts_hold_nonneg CHECK (hold_amount >= 0),
  CONSTRAINT ev_wallet_accounts_hold_lte_balance CHECK (hold_amount <= balance_amount),
  CONSTRAINT ev_wallet_accounts_status_check CHECK (status IN ('active', 'blocked', 'closed'))
);

CREATE TABLE IF NOT EXISTS "EV_WalletLedger" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_account_id UUID NOT NULL REFERENCES "EV_WalletAccounts"(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES "EV_Users"(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  balance_before NUMERIC(12, 2) NOT NULL DEFAULT 0,
  balance_after NUMERIC(12, 2) NOT NULL DEFAULT 0,
  reference_type TEXT NOT NULL,
  reference_id UUID NULL,
  remarks TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ev_wallet_ledger_tx_type_check CHECK (
    transaction_type IN ('credit', 'debit', 'hold', 'release', 'refund', 'adjustment')
  ),
  CONSTRAINT ev_wallet_ledger_ref_type_check CHECK (
    reference_type IN ('topup', 'payment_order', 'charging_session', 'refund', 'admin_adjustment', 'hold', 'release')
  )
);

CREATE TABLE IF NOT EXISTS "EV_PaymentOrders" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "EV_Users"(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  gateway_name TEXT NULL,
  gateway_order_id TEXT NULL,
  gateway_payment_id TEXT NULL,
  checkout_url TEXT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  wallet_credited BOOLEAN NOT NULL DEFAULT FALSE,
  failure_reason TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ev_payment_orders_amount_min CHECK (amount >= 100),
  CONSTRAINT ev_payment_orders_status_check CHECK (
    status IN ('created', 'pending', 'paid', 'failed', 'cancelled', 'expired')
  )
);

CREATE TABLE IF NOT EXISTS "EV_PaymentTransactions" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_order_id UUID NOT NULL REFERENCES "EV_PaymentOrders"(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES "EV_Users"(id) ON DELETE CASCADE,
  gateway_name TEXT NULL,
  gateway_order_id TEXT NULL,
  gateway_payment_id TEXT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL,
  raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "EV_PaymentWebhooks" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_name TEXT NULL,
  event_type TEXT NULL,
  gateway_order_id TEXT NULL,
  gateway_payment_id TEXT NULL,
  signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ev_wallet_accounts_user_id ON "EV_WalletAccounts" (user_id);
CREATE INDEX IF NOT EXISTS idx_ev_wallet_ledger_user_id ON "EV_WalletLedger" (user_id);
CREATE INDEX IF NOT EXISTS idx_ev_wallet_ledger_wallet_id ON "EV_WalletLedger" (wallet_account_id);
CREATE INDEX IF NOT EXISTS idx_ev_payment_orders_user_id ON "EV_PaymentOrders" (user_id);
CREATE INDEX IF NOT EXISTS idx_ev_payment_orders_status ON "EV_PaymentOrders" (status);
CREATE INDEX IF NOT EXISTS idx_ev_payment_transactions_order_id ON "EV_PaymentTransactions" (payment_order_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE "EV_WalletAccounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_WalletLedger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_PaymentOrders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_PaymentTransactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_PaymentWebhooks" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ev_wallet_accounts_select_own" ON "EV_WalletAccounts";
CREATE POLICY "ev_wallet_accounts_select_own" ON "EV_WalletAccounts"
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_wallet_ledger_select_own" ON "EV_WalletLedger";
CREATE POLICY "ev_wallet_ledger_select_own" ON "EV_WalletLedger"
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_payment_orders_select_own" ON "EV_PaymentOrders";
CREATE POLICY "ev_payment_orders_select_own" ON "EV_PaymentOrders"
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_payment_transactions_select_own" ON "EV_PaymentTransactions";
CREATE POLICY "ev_payment_transactions_select_own" ON "EV_PaymentTransactions"
  FOR SELECT TO anon, authenticated USING (true);

-- No mobile access to webhooks
DROP POLICY IF EXISTS "ev_payment_webhooks_deny_all" ON "EV_PaymentWebhooks";
CREATE POLICY "ev_payment_webhooks_deny_all" ON "EV_PaymentWebhooks"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- Deny direct wallet balance / ledger writes from mobile roles
DROP POLICY IF EXISTS "ev_wallet_accounts_no_client_write" ON "EV_WalletAccounts";
CREATE POLICY "ev_wallet_accounts_no_client_write" ON "EV_WalletAccounts"
  FOR INSERT TO anon, authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "ev_wallet_accounts_no_client_update" ON "EV_WalletAccounts";
CREATE POLICY "ev_wallet_accounts_no_client_update" ON "EV_WalletAccounts"
  FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "ev_wallet_ledger_no_client_write" ON "EV_WalletLedger";
CREATE POLICY "ev_wallet_ledger_no_client_write" ON "EV_WalletLedger"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "ev_payment_orders_no_client_insert" ON "EV_PaymentOrders";
CREATE POLICY "ev_payment_orders_no_client_insert" ON "EV_PaymentOrders"
  FOR INSERT TO anon, authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "ev_payment_orders_no_client_update" ON "EV_PaymentOrders";
CREATE POLICY "ev_payment_orders_no_client_update" ON "EV_PaymentOrders"
  FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "ev_payment_transactions_no_client_write" ON "EV_PaymentTransactions";
CREATE POLICY "ev_payment_transactions_no_client_write" ON "EV_PaymentTransactions"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- RPC helpers (SECURITY DEFINER — mobile passes EV_Users.id as p_user_id)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ev_get_or_create_wallet_account(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  balance_amount NUMERIC,
  hold_amount NUMERIC,
  currency TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "EV_Users" u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  INSERT INTO "EV_WalletAccounts" (user_id)
  VALUES (p_user_id)
  ON CONFLICT ON CONSTRAINT ev_wallet_accounts_user_unique DO NOTHING;

  RETURN QUERY
  SELECT w.id, w.user_id, w.balance_amount, w.hold_amount, w.currency, w.status, w.created_at, w.updated_at
  FROM "EV_WalletAccounts" w
  WHERE w.user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION ev_get_wallet_summary(p_user_id UUID)
RETURNS TABLE (
  wallet_account_id UUID,
  balance_amount NUMERIC,
  hold_amount NUMERIC,
  usable_balance NUMERIC,
  currency TEXT,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  PERFORM ev_get_or_create_wallet_account(p_user_id);

  RETURN QUERY
  SELECT
    w.id,
    w.balance_amount,
    w.hold_amount,
    (w.balance_amount - w.hold_amount) AS usable_balance,
    w.currency,
    w.status
  FROM "EV_WalletAccounts" w
  WHERE w.user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION ev_create_topup_order(
  p_user_id UUID,
  p_amount NUMERIC,
  p_gateway_name TEXT DEFAULT NULL
)
RETURNS TABLE (
  payment_order_id UUID,
  amount NUMERIC,
  status TEXT,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_order_id UUID;
  v_gateway TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "EV_Users" u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  IF p_amount IS NULL OR p_amount < 100 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  PERFORM ev_get_or_create_wallet_account(p_user_id);

  v_gateway := COALESCE(NULLIF(trim(p_gateway_name), ''), 'dfccil_gateway_pending');

  INSERT INTO "EV_PaymentOrders" (
    user_id, amount, currency, gateway_name, status, wallet_credited, metadata
  )
  VALUES (
    p_user_id,
    round(p_amount::numeric, 2),
    'INR',
    v_gateway,
    'created',
    false,
    jsonb_build_object('source', 'mobile_topup')
  )
  RETURNING id INTO v_order_id;

  RETURN QUERY
  SELECT v_order_id, round(p_amount::numeric, 2), 'created'::text,
    'Top-up order created. Awaiting gateway confirmation.'::text;
END;
$$;

CREATE OR REPLACE FUNCTION ev_get_payment_order_status(
  p_user_id UUID,
  p_payment_order_id UUID
)
RETURNS TABLE (
  payment_order_id UUID,
  amount NUMERIC,
  currency TEXT,
  status TEXT,
  wallet_credited BOOLEAN,
  failure_reason TEXT,
  checkout_url TEXT,
  gateway_name TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.amount,
    o.currency,
    o.status,
    o.wallet_credited,
    o.failure_reason,
    o.checkout_url,
    o.gateway_name,
    o.created_at,
    o.updated_at
  FROM "EV_PaymentOrders" o
  WHERE o.id = p_payment_order_id
    AND o.user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION ev_get_wallet_ledger(
  p_user_id UUID,
  p_limit INT DEFAULT 50,
  p_filter TEXT DEFAULT 'all'
)
RETURNS TABLE (
  id UUID,
  wallet_account_id UUID,
  transaction_type TEXT,
  amount NUMERIC,
  balance_before NUMERIC,
  balance_after NUMERIC,
  reference_type TEXT,
  reference_id UUID,
  remarks TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT
    l.id,
    l.wallet_account_id,
    l.transaction_type,
    l.amount,
    l.balance_before,
    l.balance_after,
    l.reference_type,
    l.reference_id,
    l.remarks,
    l.created_at
  FROM "EV_WalletLedger" l
  WHERE l.user_id = p_user_id
    AND (
      p_filter = 'all'
      OR (p_filter = 'credit' AND l.transaction_type = 'credit')
      OR (p_filter = 'debit' AND l.transaction_type = 'debit')
      OR (p_filter = 'hold' AND l.transaction_type IN ('hold', 'release'))
    )
  ORDER BY l.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
END;
$$;

GRANT EXECUTE ON FUNCTION ev_get_or_create_wallet_account(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_get_wallet_summary(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_create_topup_order(UUID, NUMERIC, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_get_payment_order_status(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_get_wallet_ledger(UUID, INT, TEXT) TO anon, authenticated;


-- =============================================================================
-- FILE: supabase/payments_wallet_admin.sql
-- =============================================================================

-- Web admin: read wallet top-ups and balances (run after create_wallet_topup_tables.sql)
-- Demo/UAT uses anon key — production should use role-scoped API.

DROP POLICY IF EXISTS "ev_anon_select_wallet_accounts" ON "EV_WalletAccounts";
CREATE POLICY "ev_anon_select_wallet_accounts" ON "EV_WalletAccounts"
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_select_wallet_ledger" ON "EV_WalletLedger";
CREATE POLICY "ev_anon_select_wallet_ledger" ON "EV_WalletLedger"
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_select_payment_orders" ON "EV_PaymentOrders";
CREATE POLICY "ev_anon_select_payment_orders" ON "EV_PaymentOrders"
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_select_payment_transactions" ON "EV_PaymentTransactions";
CREATE POLICY "ev_anon_select_payment_transactions" ON "EV_PaymentTransactions"
  FOR SELECT TO anon, authenticated USING (true);


-- =============================================================================
-- FILE: mobile/SUPABASE_MOBILE_POLICIES.sql
-- =============================================================================

-- Run in Supabase SQL Editor after schema.sql + rls.sql + policies_write.sql
-- Enables mobile app writes (start/stop sessions, support tickets, push tokens) via anon key (demo only).
-- Canonical copy also lives at supabase/mobile_policies.sql

DROP POLICY IF EXISTS "ev_anon_insert_sessions" ON "EV_ChargingSessions";
CREATE POLICY "ev_anon_insert_sessions" ON "EV_ChargingSessions"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_update_sessions" ON "EV_ChargingSessions";
CREATE POLICY "ev_anon_update_sessions" ON "EV_ChargingSessions"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_insert_support" ON "EV_SupportTickets";
CREATE POLICY "ev_anon_insert_support" ON "EV_SupportTickets"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE TABLE IF NOT EXISTS "EV_UserPushTokens" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "EV_Users"(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_ev_push_tokens_user ON "EV_UserPushTokens" (user_id);

ALTER TABLE "EV_UserPushTokens" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ev_anon_manage_push_tokens" ON "EV_UserPushTokens";
CREATE POLICY "ev_anon_manage_push_tokens" ON "EV_UserPushTokens"
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON "EV_UserPushTokens" TO anon, authenticated;

DROP POLICY IF EXISTS "ev_media_public_read" ON storage.objects;
CREATE POLICY "ev_media_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'ev-media');

DROP POLICY IF EXISTS "ev_media_anon_upload" ON storage.objects;
CREATE POLICY "ev_media_anon_upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'ev-media' AND (storage.foldername(name))[1] = 'EV');

DROP POLICY IF EXISTS "ev_media_anon_update" ON storage.objects;
CREATE POLICY "ev_media_anon_update" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'ev-media')
  WITH CHECK (bucket_id = 'ev-media');

DROP POLICY IF EXISTS "ev_media_anon_delete" ON storage.objects;
CREATE POLICY "ev_media_anon_delete" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'ev-media');

UPDATE "EV_Chargers" SET latitude = 28.6145, longitude = 77.2085 WHERE charge_point_id = 'MP-DC-001';
UPDATE "EV_Chargers" SET latitude = 28.6148, longitude = 77.2092 WHERE charge_point_id = 'MP-DC-002';
UPDATE "EV_Chargers" SET latitude = 19.0765, longitude = 72.8785 WHERE charge_point_id = 'MP-DC-003';
UPDATE "EV_Chargers" SET latitude = 19.0770, longitude = 72.8790 WHERE charge_point_id = 'MP-DC-004';
UPDATE "EV_Chargers" SET latitude = 28.6120, longitude = 77.2050 WHERE charge_point_id = 'MP-AC-001';
UPDATE "EV_Chargers" SET latitude = 28.6125, longitude = 77.2055 WHERE charge_point_id = 'MP-AC-002';
UPDATE "EV_Chargers" SET latitude = 28.6130, longitude = 77.2060 WHERE charge_point_id = 'MP-AC-003';
UPDATE "EV_Chargers" SET latitude = 13.0830, longitude = 80.2710 WHERE charge_point_id = 'MP-AC-004';
UPDATE "EV_Chargers" SET latitude = 13.0835, longitude = 80.2715 WHERE charge_point_id = 'MP-AC-005';
UPDATE "EV_Chargers" SET latitude = 13.0840, longitude = 80.2720 WHERE charge_point_id = 'MP-AC-006';
UPDATE "EV_Chargers" SET latitude = 22.5730, longitude = 88.3640 WHERE charge_point_id = 'TS-DC-001';
UPDATE "EV_Chargers" SET latitude = 22.5735, longitude = 88.3645 WHERE charge_point_id = 'TS-AC-001';


-- =============================================================================
-- FILE: mobile/CUSTOM_PUSH_NOTIFICATIONS.sql
-- =============================================================================

-- EV CMS custom push + in-app notifications (extends existing EV_ tables).
-- Uses EV_Users.id (custom auth — not auth.users).
-- Run in Supabase SQL Editor after schema.sql + mobile policies.

-- ---------------------------------------------------------------------------
-- Extend EV_UserPushTokens (already created in SUPABASE_MOBILE_POLICIES.sql)
-- ---------------------------------------------------------------------------
ALTER TABLE "EV_UserPushTokens" ADD COLUMN IF NOT EXISTS token_type TEXT NOT NULL DEFAULT 'expo';
ALTER TABLE "EV_UserPushTokens" ADD COLUMN IF NOT EXISTS device_id TEXT NULL;
ALTER TABLE "EV_UserPushTokens" ADD COLUMN IF NOT EXISTS device_name TEXT NULL;
ALTER TABLE "EV_UserPushTokens" ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "EV_UserPushTokens" ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ---------------------------------------------------------------------------
-- Extend EV_Notifications (message = body, read = is_read in mobile app)
-- ---------------------------------------------------------------------------
ALTER TABLE "EV_Notifications" ADD COLUMN IF NOT EXISTS reference_type TEXT NULL;
ALTER TABLE "EV_Notifications" ADD COLUMN IF NOT EXISTS reference_id UUID NULL;
ALTER TABLE "EV_Notifications" ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "EV_Notifications" ADD COLUMN IF NOT EXISTS push_sent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EV_Notifications" ADD COLUMN IF NOT EXISTS push_sent_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN "EV_Notifications"."message" IS 'Notification body text (shown as body in mobile UI)';
COMMENT ON COLUMN "EV_Notifications"."read" IS 'Read flag (is_read in mobile UI)';

-- Allowed notification types (enforced in backend; mobile displays any type):
-- charging_started, charging_stopped, payment_success, payment_failed,
-- wallet_low_balance, support_ticket_updated, charger_fault, charger_offline, general
-- Legacy types from seed: info, alert, warning, success, session

ALTER TABLE "EV_UserPushTokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_Notifications" ENABLE ROW LEVEL SECURITY;

-- Push tokens: mobile manages own rows (demo uses anon + app filters by user_id)
DROP POLICY IF EXISTS "ev_push_tokens_select" ON "EV_UserPushTokens";
CREATE POLICY "ev_push_tokens_select" ON "EV_UserPushTokens"
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_push_tokens_insert" ON "EV_UserPushTokens";
CREATE POLICY "ev_push_tokens_insert" ON "EV_UserPushTokens"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_push_tokens_update" ON "EV_UserPushTokens";
CREATE POLICY "ev_push_tokens_update" ON "EV_UserPushTokens"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ev_push_tokens_delete" ON "EV_UserPushTokens";
CREATE POLICY "ev_push_tokens_delete" ON "EV_UserPushTokens"
  FOR DELETE TO anon, authenticated USING (true);

-- Notifications: users read/update own rows; system inserts via ev_notify_user (SECURITY DEFINER)
DROP POLICY IF EXISTS "ev_notifications_select" ON "EV_Notifications";
CREATE POLICY "ev_notifications_select" ON "EV_Notifications"
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_notifications_update_read" ON "EV_Notifications";
CREATE POLICY "ev_notifications_update_read" ON "EV_Notifications"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Mobile must NOT insert system notifications (charging/payment/etc.) — use backend RPC only.
DROP POLICY IF EXISTS "ev_anon_insert_notifications" ON "EV_Notifications";

-- Realtime: enable EV_Notifications in Dashboard → Database → Replication


-- =============================================================================
-- FILE: mobile/RAZORPAY_WALLET.sql
-- =============================================================================

-- Complete wallet top-up after Razorpay verification (run in Supabase SQL Editor).

CREATE OR REPLACE FUNCTION ev_complete_wallet_topup(
  p_user_id UUID,
  p_payment_order_id UUID,
  p_gateway_order_id TEXT,
  p_gateway_payment_id TEXT
)
RETURNS TABLE (
  payment_order_id UUID,
  amount NUMERIC,
  currency TEXT,
  status TEXT,
  wallet_credited BOOLEAN,
  failure_reason TEXT,
  gateway_name TEXT,
  gateway_order_id TEXT,
  gateway_payment_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_order RECORD;
  v_wallet RECORD;
  v_balance_after NUMERIC;
BEGIN
  SELECT *
  INTO v_order
  FROM "EV_PaymentOrders" o
  WHERE o.id = p_payment_order_id
    AND o.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND';
  END IF;

  IF v_order.wallet_credited OR v_order.status = 'paid' THEN
    RETURN QUERY
    SELECT
      v_order.id,
      v_order.amount,
      v_order.currency,
      v_order.status,
      v_order.wallet_credited,
      v_order.failure_reason,
      v_order.gateway_name,
      v_order.gateway_order_id,
      NULL::text;
    RETURN;
  END IF;

  PERFORM ev_get_or_create_wallet_account(p_user_id);

  SELECT w.*
  INTO v_wallet
  FROM "EV_WalletAccounts" w
  WHERE w.user_id = p_user_id
  FOR UPDATE;

  v_balance_after := v_wallet.balance_amount + v_order.amount;

  UPDATE "EV_WalletAccounts"
  SET balance_amount = v_balance_after, updated_at = NOW()
  WHERE id = v_wallet.id;

  INSERT INTO "EV_WalletLedger" (
    wallet_account_id, user_id, transaction_type, amount,
    balance_before, balance_after, reference_type, reference_id, remarks
  )
  VALUES (
    v_wallet.id, p_user_id, 'credit', v_order.amount,
    v_wallet.balance_amount, v_balance_after, 'payment_order', p_payment_order_id,
    'Wallet top-up via Razorpay'
  );

  UPDATE "EV_PaymentOrders"
  SET
    status = 'paid',
    wallet_credited = true,
    gateway_name = COALESCE(gateway_name, 'razorpay'),
    gateway_order_id = COALESCE(p_gateway_order_id, gateway_order_id),
    gateway_payment_id = p_gateway_payment_id,
    updated_at = NOW()
  WHERE id = p_payment_order_id;

  RETURN QUERY
  SELECT
    p_payment_order_id,
    v_order.amount,
    v_order.currency,
    'paid'::text,
    true,
    NULL::text,
    COALESCE(v_order.gateway_name, 'razorpay'),
    p_gateway_order_id,
    p_gateway_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION ev_complete_wallet_topup(UUID, UUID, TEXT, TEXT) TO service_role;


-- =============================================================================
-- FILE: mobile/SESSION_WALLET_PAYMENT.sql
-- =============================================================================

-- Deprecated: wallet-based session payment. Use SESSION_RAZORPAY_PAYMENT.sql instead.
-- Mobile now charges sessions directly via Razorpay after charging ends.


-- =============================================================================
-- FILE: mobile/SESSION_RAZORPAY_PAYMENT.sql
-- =============================================================================

-- Direct session payment via Razorpay (no wallet). Run in Supabase SQL Editor.
-- Replaces wallet-based session payment for the mobile app.

-- Recalculate pending payment from session energy × active tariff before checkout.
-- Prepaid sessions with prepaid_total_inr and zero energy keep prepaid amounts (do not wipe).
CREATE OR REPLACE FUNCTION ev_sync_session_payment_bill(
  p_user_id UUID,
  p_session_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_bill RECORD;
BEGIN
  SELECT s.id, s.user_id, s.energy_kwh, s.tariff_id, s.prepaid_total_inr, s.prepaid_mode
  INTO v_sess
  FROM "EV_ChargingSessions" s
  WHERE s.id = p_session_id
    AND s.user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND';
  END IF;

  -- Keep prepaid checkout totals until energy is delivered / settlement runs.
  IF COALESCE(v_sess.prepaid_total_inr, 0) > 0 AND COALESCE(v_sess.energy_kwh, 0) = 0 THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_bill
  FROM ev_calculate_session_bill(COALESCE(v_sess.energy_kwh, 0), v_sess.tariff_id)
  LIMIT 1;

  UPDATE "EV_ChargingSessions"
  SET amount = v_bill.amount, updated_at = NOW()
  WHERE id = p_session_id;

  UPDATE "EV_Payments"
  SET
    amount = v_bill.amount,
    gst_amount = v_bill.gst_amount,
    total_amount = v_bill.total_amount,
    updated_at = NOW()
  WHERE session_id = p_session_id
    AND user_id = p_user_id
    AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION ev_sync_session_payment_bill(UUID, UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ev_get_session_payment(
  p_user_id UUID,
  p_session_id UUID
)
RETURNS TABLE (
  payment_id UUID,
  session_id UUID,
  amount NUMERIC,
  gst_amount NUMERIC,
  total_amount NUMERIC,
  status TEXT,
  amount_due NUMERIC,
  gateway_order_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.session_id,
    p.amount,
    p.gst_amount,
    p.total_amount,
    p.status,
    CASE
      WHEN p.status IN ('success', 'paid') THEN 0::numeric
      ELSE p.total_amount
    END,
    CASE
      WHEN p.gateway = 'razorpay' AND p.status = 'pending' THEN p.gateway_txn_id
      ELSE NULL::text
    END
  FROM "EV_Payments" p
  WHERE p.session_id = p_session_id
    AND p.user_id = p_user_id
  ORDER BY p.created_at DESC
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION ev_bind_session_razorpay_order(
  p_user_id UUID,
  p_payment_id UUID,
  p_gateway_order_id TEXT
)
RETURNS TABLE (
  payment_id UUID,
  session_id UUID,
  amount NUMERIC,
  status TEXT,
  gateway_order_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_payment RECORD;
BEGIN
  SELECT p.*
  INTO v_payment
  FROM "EV_Payments" p
  WHERE p.id = p_payment_id
    AND p.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
  END IF;

  IF v_payment.status IN ('success', 'paid') THEN
    RAISE EXCEPTION 'PAYMENT_ALREADY_COMPLETED';
  END IF;

  UPDATE "EV_Payments"
  SET
    gateway = 'razorpay',
    gateway_txn_id = p_gateway_order_id,
    updated_at = NOW()
  WHERE id = p_payment_id;

  RETURN QUERY
  SELECT
    v_payment.id,
    v_payment.session_id,
    v_payment.amount,
    v_payment.status,
    p_gateway_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION ev_complete_session_razorpay_payment(
  p_user_id UUID,
  p_payment_id UUID,
  p_gateway_order_id TEXT,
  p_gateway_payment_id TEXT
)
RETURNS TABLE (
  payment_id UUID,
  session_id UUID,
  amount NUMERIC,
  status TEXT,
  receipt_number TEXT,
  gateway_order_id TEXT,
  gateway_payment_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_payment RECORD;
  v_receipt_number TEXT;
BEGIN
  SELECT p.*
  INTO v_payment
  FROM "EV_Payments" p
  WHERE p.id = p_payment_id
    AND p.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
  END IF;

  IF v_payment.status IN ('success', 'paid') THEN
    SELECT r.receipt_number
    INTO v_receipt_number
    FROM "EV_Receipts" r
    WHERE r.payment_id = v_payment.id
    LIMIT 1;

    RETURN QUERY
    SELECT
      v_payment.id,
      v_payment.session_id,
      v_payment.amount,
      v_payment.status,
      v_receipt_number,
      COALESCE(v_payment.gateway_txn_id, p_gateway_order_id),
      COALESCE(v_payment.gateway_txn_id, p_gateway_payment_id);
    RETURN;
  END IF;

  IF v_payment.gateway_txn_id IS NOT NULL
     AND v_payment.gateway_txn_id <> p_gateway_order_id THEN
    RAISE EXCEPTION 'GATEWAY_ORDER_MISMATCH';
  END IF;

  UPDATE "EV_Payments"
  SET
    status = 'success',
    gateway = 'razorpay',
    gateway_txn_id = p_gateway_payment_id,
    reconciliation_status = 'matched',
    updated_at = NOW()
  WHERE id = p_payment_id;

  SELECT r.receipt_number
  INTO v_receipt_number
  FROM "EV_Receipts" r
  WHERE r.payment_id = p_payment_id
  LIMIT 1;

  IF v_receipt_number IS NULL THEN
    v_receipt_number := 'RCP-' || UPPER(SUBSTRING(REPLACE(p_payment_id::text, '-', ''), 1, 8))
      || '-' || UPPER(TO_CHAR(NOW(), 'YYMMDDHH24MI'));
    INSERT INTO "EV_Receipts" (payment_id, receipt_number, pdf_url)
    VALUES (
      p_payment_id,
      v_receipt_number,
      'https://ev-cms.dfccil.gov.in/receipts/' || v_receipt_number || '.pdf'
    );
  END IF;

  RETURN QUERY
  SELECT
    p_payment_id,
    v_payment.session_id,
    v_payment.amount,
    'success'::text,
    v_receipt_number,
    p_gateway_order_id,
    p_gateway_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION ev_get_session_payment(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_bind_session_razorpay_order(UUID, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_complete_session_razorpay_payment(UUID, UUID, TEXT, TEXT) TO service_role;


-- =============================================================================
-- FILE: mobile/SUPPORT_TICKET_ATTACHMENTS.sql
-- =============================================================================

-- Support ticket attachments in ev-media bucket.
-- Path: support-tickets/{user_id}/{ticket_id}/{filename}
-- Run in Supabase SQL Editor after schema.sql + mobile policies.

ALTER TABLE "EV_SupportTickets"
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN "EV_SupportTickets"."attachments" IS
  'Array of {name, path, url, mimeType, size, uploadedAt} for files in ev-media/support-tickets/{user_id}/{ticket_id}/';

-- Allow images + PDF for ticket attachments (bucket may already exist).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ev-media',
  'ev-media',
  true,
  10485760,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "ev_media_anon_upload" ON storage.objects;
CREATE POLICY "ev_media_anon_upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'ev-media'
    AND (
      (storage.foldername(name))[1] = 'EV'
      OR (
        (storage.foldername(name))[1] = 'support-tickets'
        AND (storage.foldername(name))[2] IS NOT NULL
        AND (storage.foldername(name))[3] IS NOT NULL
      )
    )
  );

DROP POLICY IF EXISTS "ev_media_anon_update" ON storage.objects;
CREATE POLICY "ev_media_anon_update" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (
    bucket_id = 'ev-media'
    AND (
      (storage.foldername(name))[1] = 'EV'
      OR (storage.foldername(name))[1] = 'support-tickets'
    )
  )
  WITH CHECK (
    bucket_id = 'ev-media'
    AND (
      (storage.foldername(name))[1] = 'EV'
      OR (
        (storage.foldername(name))[1] = 'support-tickets'
        AND (storage.foldername(name))[2] IS NOT NULL
        AND (storage.foldername(name))[3] IS NOT NULL
      )
    )
  );

DROP POLICY IF EXISTS "ev_media_anon_delete" ON storage.objects;
CREATE POLICY "ev_media_anon_delete" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (
    bucket_id = 'ev-media'
    AND (
      (storage.foldername(name))[1] = 'EV'
      OR (storage.foldername(name))[1] = 'support-tickets'
    )
  );


-- =============================================================================
-- FILE: supabase/tariff_billing.sql
-- =============================================================================

-- Tariff-based session billing (kWh × rate, optional GST from tariff).
-- Run in Supabase SQL Editor after schema.sql.

ALTER TABLE "EV_Tariffs"
  ADD COLUMN IF NOT EXISTS region TEXT,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "EV_Tariffs".region IS 'Geographic label e.g. Noida, Uttar Pradesh';
COMMENT ON COLUMN "EV_Tariffs".is_default IS 'Default tariff for new sessions when no charger override is set';

CREATE INDEX IF NOT EXISTS idx_ev_tariffs_is_default ON "EV_Tariffs" (is_default) WHERE is_default = true;

CREATE OR REPLACE FUNCTION ev_get_default_tariff_id()
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT id
  FROM "EV_Tariffs"
  WHERE is_active = true AND is_default = true
  ORDER BY updated_at DESC, created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION ev_resolve_tariff_id(p_tariff_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_tariff_id IS NOT NULL THEN
    SELECT t.id
    INTO v_id
    FROM "EV_Tariffs" t
    WHERE t.id = p_tariff_id AND t.is_active = true;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;

  v_id := ev_get_default_tariff_id();
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT t.id
  INTO v_id
  FROM "EV_Tariffs" t
  WHERE t.is_active = true
  ORDER BY t.created_at
  LIMIT 1;

  RETURN v_id;
END;
$$;

-- Bill = consumed kWh × rate_per_kwh; GST applied when tariff.gst_percent > 0.
CREATE OR REPLACE FUNCTION ev_calculate_session_bill(
  p_energy_kwh NUMERIC,
  p_tariff_id UUID DEFAULT NULL
)
RETURNS TABLE (
  tariff_id UUID,
  rate_per_kwh NUMERIC,
  gst_percent NUMERIC,
  amount NUMERIC,
  gst_amount NUMERIC,
  total_amount NUMERIC
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_tariff_id UUID;
  v_rate NUMERIC;
  v_gst_pct NUMERIC;
  v_energy NUMERIC;
  v_amount NUMERIC;
  v_gst NUMERIC;
BEGIN
  v_energy := GREATEST(COALESCE(p_energy_kwh, 0), 0);
  v_tariff_id := ev_resolve_tariff_id(p_tariff_id);

  IF v_tariff_id IS NULL THEN
    RAISE EXCEPTION 'NO_ACTIVE_TARIFF';
  END IF;

  SELECT t.rate_per_kwh, t.gst_percent
  INTO v_rate, v_gst_pct
  FROM "EV_Tariffs" t
  WHERE t.id = v_tariff_id;

  v_amount := ROUND(v_energy * v_rate, 2);
  v_gst := CASE
    WHEN COALESCE(v_gst_pct, 0) > 0 THEN ROUND(v_amount * v_gst_pct / 100, 2)
    ELSE 0
  END;

  RETURN QUERY
  SELECT
    v_tariff_id,
    v_rate,
    COALESCE(v_gst_pct, 0),
    v_amount,
    v_gst,
    v_amount + v_gst;
END;
$$;

-- Temporary default: Noida / Uttar Pradesh @ ₹7.70/kWh (admin can update rate or GST in EV_Tariffs).
INSERT INTO "EV_Tariffs" (
  id, name, rate_per_kwh, session_fee, gst_percent, applies_to, is_active, is_default, region, created_at
) VALUES (
  'e0000001-0000-4000-8000-000000000010',
  'Noida / UP — Standard (Temporary)',
  7.70,
  0,
  18,
  'All',
  true,
  true,
  'Noida, Uttar Pradesh',
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  rate_per_kwh = EXCLUDED.rate_per_kwh,
  session_fee = EXCLUDED.session_fee,
  gst_percent = EXCLUDED.gst_percent,
  applies_to = EXCLUDED.applies_to,
  is_active = EXCLUDED.is_active,
  is_default = EXCLUDED.is_default,
  region = EXCLUDED.region,
  updated_at = NOW();

UPDATE "EV_Tariffs"
SET is_default = false, updated_at = NOW()
WHERE id <> 'e0000001-0000-4000-8000-000000000010'
  AND is_default = true;

GRANT EXECUTE ON FUNCTION ev_get_default_tariff_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_resolve_tariff_id(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_calculate_session_bill(NUMERIC, UUID) TO anon, authenticated;


-- =============================================================================
-- FILE: supabase/prepaid_billing.sql
-- =============================================================================

-- Prepaid-only charging (no postpaid product path).
-- Run in Supabase SQL Editor after schema.sql / tariff_billing.sql.

-- =============================================================================
-- Prepaid plan presets (admin CRUD)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "EV_PrepaidPlans" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL CHECK (mode IN ('amount', 'time')),
  value NUMERIC(12, 2) NOT NULL CHECK (value > 0),
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "EV_PrepaidPlans" IS 'Admin presets: pay-before-charge by amount (INR) or time (minutes)';
COMMENT ON COLUMN "EV_PrepaidPlans".mode IS 'amount = INR prepaid; time = minutes prepaid';
COMMENT ON COLUMN "EV_PrepaidPlans".value IS 'INR when mode=amount; minutes when mode=time';

CREATE INDEX IF NOT EXISTS idx_ev_prepaid_plans_active_sort
  ON "EV_PrepaidPlans" (is_active, sort_order, mode);

ALTER TABLE "EV_PrepaidPlans" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ev_anon_select_prepaid_plans" ON "EV_PrepaidPlans";
CREATE POLICY "ev_anon_select_prepaid_plans" ON "EV_PrepaidPlans"
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_insert_prepaid_plans" ON "EV_PrepaidPlans";
CREATE POLICY "ev_anon_insert_prepaid_plans" ON "EV_PrepaidPlans"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_update_prepaid_plans" ON "EV_PrepaidPlans";
CREATE POLICY "ev_anon_update_prepaid_plans" ON "EV_PrepaidPlans"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_delete_prepaid_plans" ON "EV_PrepaidPlans";
CREATE POLICY "ev_anon_delete_prepaid_plans" ON "EV_PrepaidPlans"
  FOR DELETE TO anon, authenticated USING (true);

-- Seed defaults (idempotent by label+mode+value)
INSERT INTO "EV_PrepaidPlans" (mode, value, label, sort_order, is_active)
SELECT v.mode, v.value, v.label, v.sort_order, true
FROM (
  VALUES
    ('amount'::text, 50::numeric, '₹50'::text, 10),
    ('amount', 100, '₹100', 20),
    ('amount', 500, '₹500', 30),
    ('time', 10, '10 min', 40),
    ('time', 15, '15 min', 50),
    ('time', 30, '30 min', 60),
    ('time', 60, '1 hour', 70)
) AS v(mode, value, label, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM "EV_PrepaidPlans" p
  WHERE p.mode = v.mode AND p.value = v.value
);

-- =============================================================================
-- Session prepaid fields
-- =============================================================================

ALTER TABLE "EV_ChargingSessions"
  ADD COLUMN IF NOT EXISTS prepaid_mode TEXT,
  ADD COLUMN IF NOT EXISTS prepaid_value NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS prepaid_total_inr NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS prepaid_energy_cap_kwh NUMERIC(12, 3),
  ADD COLUMN IF NOT EXISTS prepaid_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prepaid_payment_id UUID,
  ADD COLUMN IF NOT EXISTS prepaid_plan_id UUID REFERENCES "EV_PrepaidPlans"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS settlement_status TEXT,
  ADD COLUMN IF NOT EXISTS settlement_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(12, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ev_charging_sessions_prepaid_mode_check'
  ) THEN
    ALTER TABLE "EV_ChargingSessions"
      ADD CONSTRAINT ev_charging_sessions_prepaid_mode_check
      CHECK (prepaid_mode IS NULL OR prepaid_mode IN ('amount', 'time'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ev_charging_sessions_settlement_status_check'
  ) THEN
    ALTER TABLE "EV_ChargingSessions"
      ADD CONSTRAINT ev_charging_sessions_settlement_status_check
      CHECK (
        settlement_status IS NULL
        OR settlement_status IN ('paid', 'active', 'settled', 'refunded', 'failed_start')
      );
  END IF;
END $$;

COMMENT ON COLUMN "EV_ChargingSessions".prepaid_mode IS 'amount | time — prepaid-only product';
COMMENT ON COLUMN "EV_ChargingSessions".prepaid_total_inr IS 'Amount collected before start (incl. GST)';
COMMENT ON COLUMN "EV_ChargingSessions".settlement_status IS 'paid→active→settled/refunded';

CREATE INDEX IF NOT EXISTS idx_ev_sessions_prepaid_expires
  ON "EV_ChargingSessions" (prepaid_expires_at)
  WHERE status = 'active' AND prepaid_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ev_sessions_settlement_status
  ON "EV_ChargingSessions" (settlement_status)
  WHERE settlement_status IS NOT NULL;

-- =============================================================================
-- Charger lab bypass (admin Start without prepaid — test only)
-- =============================================================================

ALTER TABLE "EV_Chargers"
  ADD COLUMN IF NOT EXISTS allow_admin_bypass BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN "EV_Chargers".allow_admin_bypass IS
  'When true, web admin may RemoteStart without prepaid (lab/test). Production should stay false.';

-- =============================================================================
-- Payments: kind (prepaid charging | refund) — no postpaid product path
-- =============================================================================

ALTER TABLE "EV_Payments"
  ADD COLUMN IF NOT EXISTS payment_kind TEXT;

UPDATE "EV_Payments"
SET payment_kind = 'prepaid'
WHERE payment_kind IS NULL;

ALTER TABLE "EV_Payments"
  ALTER COLUMN payment_kind SET DEFAULT 'prepaid';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ev_payments_payment_kind_check'
  ) THEN
    ALTER TABLE "EV_Payments"
      ADD CONSTRAINT ev_payments_payment_kind_check
      CHECK (payment_kind IN ('prepaid', 'refund'));
  END IF;
END $$;

COMMENT ON COLUMN "EV_Payments".payment_kind IS 'prepaid = charging pay-before-start; refund = unused prepaid return';

-- =============================================================================
-- Settlement helper (gateway / stop path)
-- =============================================================================

CREATE OR REPLACE FUNCTION ev_settle_prepaid_session(p_session_id UUID)
RETURNS TABLE (
  session_id UUID,
  prepaid_total NUMERIC,
  actual_total NUMERIC,
  refund_amount NUMERIC,
  settlement_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_bill RECORD;
  v_actual NUMERIC;
  v_prepaid NUMERIC;
  v_refund NUMERIC;
  v_status TEXT;
BEGIN
  SELECT *
  INTO v_sess
  FROM "EV_ChargingSessions" s
  WHERE s.id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND';
  END IF;

  v_prepaid := COALESCE(v_sess.prepaid_total_inr, 0);

  SELECT *
  INTO v_bill
  FROM ev_calculate_session_bill(COALESCE(v_sess.energy_kwh, 0), v_sess.tariff_id)
  LIMIT 1;

  v_actual := COALESCE(v_bill.total_amount, 0);
  -- No-refund policy: prepaid amount is fully retained; never refund the difference.
  v_refund := 0;
  v_status := 'settled';

  UPDATE "EV_ChargingSessions"
  SET
    amount = v_bill.amount,
    settlement_amount = v_prepaid,
    refund_amount = v_refund,
    settlement_status = v_status,
    updated_at = NOW()
  WHERE id = p_session_id;

  -- No-refund policy: prepaid collection is final; keep the full prepaid as the collected total.
  UPDATE "EV_Payments"
  SET
    amount = v_bill.amount,
    gst_amount = v_bill.gst_amount,
    total_amount = COALESCE(total_amount, v_prepaid),
    payment_kind = COALESCE(payment_kind, 'prepaid'),
    updated_at = NOW()
  WHERE "EV_Payments".session_id = p_session_id
    AND COALESCE("EV_Payments".payment_kind, 'prepaid') = 'prepaid';

  RETURN QUERY
  SELECT p_session_id, v_prepaid, v_actual, v_refund, v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION ev_settle_prepaid_session(UUID) TO anon, authenticated, service_role;


-- =============================================================================
-- FILE: supabase/session_prepaid_amount.sql
-- =============================================================================

-- Optional prepaid amount / target kWh entered before start (petrol-pump style).
-- Run in Supabase SQL Editor.

ALTER TABLE "EV_ChargingSessions"
  ADD COLUMN IF NOT EXISTS prepaid_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS target_kwh NUMERIC(12, 3);

COMMENT ON COLUMN "EV_ChargingSessions".prepaid_amount IS
  'User-requested spend amount (₹) entered before charging';
COMMENT ON COLUMN "EV_ChargingSessions".target_kwh IS
  'User-requested energy (kWh) entered before charging';


-- =============================================================================
-- FILE: supabase/prepaid_session_completion.sql
-- =============================================================================

-- Prepaid session completion: do not ask for payment again after stop.
-- Run in Supabase SQL Editor after prepaid_billing.sql / SESSION_RAZORPAY_PAYMENT.sql.
-- Mobile-only product path; admin web RemoteStart is unchanged.

-- =============================================================================
-- Optional session payment metadata (safe IF NOT EXISTS)
-- =============================================================================

ALTER TABLE "EV_ChargingSessions"
  ADD COLUMN IF NOT EXISTS payment_mode TEXT,
  ADD COLUMN IF NOT EXISTS prepaid_type TEXT,
  ADD COLUMN IF NOT EXISTS payment_status TEXT,
  ADD COLUMN IF NOT EXISTS payment_id UUID,
  ADD COLUMN IF NOT EXISTS prepaid_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS prepaid_duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS amount_due NUMERIC(12, 2) DEFAULT 0;

COMMENT ON COLUMN "EV_ChargingSessions".payment_mode IS
  'prepaid | postpaid | pay_after_session — mobile completion banner uses this';
COMMENT ON COLUMN "EV_ChargingSessions".prepaid_type IS
  'amount | time when payment_mode=prepaid (mirrors prepaid_mode)';
COMMENT ON COLUMN "EV_ChargingSessions".payment_status IS
  'pending | paid | failed — prepaid starts as paid after Razorpay success';
COMMENT ON COLUMN "EV_ChargingSessions".amount_due IS
  'Post-session amount still owed; must stay 0 for prepaid sessions';

-- Backfill from existing prepaid fields
UPDATE "EV_ChargingSessions"
SET
  payment_mode = COALESCE(payment_mode, 'prepaid'),
  prepaid_type = COALESCE(prepaid_type, prepaid_mode),
  payment_status = COALESCE(payment_status, 'paid'),
  prepaid_amount = COALESCE(prepaid_amount, prepaid_total_inr),
  amount_due = 0
WHERE prepaid_mode IS NOT NULL
   OR COALESCE(prepaid_total_inr, 0) > 0;

-- =============================================================================
-- Sync bill: never reopen prepaid as pending / amount_due
-- =============================================================================

CREATE OR REPLACE FUNCTION ev_sync_session_payment_bill(
  p_user_id UUID,
  p_session_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_bill RECORD;
BEGIN
  SELECT
    s.id,
    s.user_id,
    s.energy_kwh,
    s.tariff_id,
    s.prepaid_total_inr,
    s.prepaid_mode,
    s.payment_mode,
    s.payment_status
  INTO v_sess
  FROM "EV_ChargingSessions" s
  WHERE s.id = p_session_id
    AND s.user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND';
  END IF;

  -- Prepaid: keep paid totals; never rewrite pending post-session bill.
  IF lower(COALESCE(v_sess.payment_mode, '')) = 'prepaid'
     OR COALESCE(v_sess.prepaid_mode, '') IN ('amount', 'time')
     OR COALESCE(v_sess.prepaid_total_inr, 0) > 0
     OR lower(COALESCE(v_sess.payment_status, '')) = 'paid'
  THEN
    UPDATE "EV_ChargingSessions"
    SET
      payment_mode = COALESCE(payment_mode, 'prepaid'),
      payment_status = COALESCE(NULLIF(payment_status, ''), 'paid'),
      amount_due = 0,
      updated_at = NOW()
    WHERE id = p_session_id;
    RETURN;
  END IF;

  SELECT *
  INTO v_bill
  FROM ev_calculate_session_bill(COALESCE(v_sess.energy_kwh, 0), v_sess.tariff_id)
  LIMIT 1;

  UPDATE "EV_ChargingSessions"
  SET amount = v_bill.amount, updated_at = NOW()
  WHERE id = p_session_id;

  UPDATE "EV_Payments"
  SET
    amount = v_bill.amount,
    gst_amount = v_bill.gst_amount,
    total_amount = v_bill.total_amount,
    updated_at = NOW()
  WHERE session_id = p_session_id
    AND user_id = p_user_id
    AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION ev_sync_session_payment_bill(UUID, UUID) TO anon, authenticated;

-- =============================================================================
-- Prefer paid prepaid payment; amount_due = 0 when paid / prepaid
-- =============================================================================

CREATE OR REPLACE FUNCTION ev_get_session_payment(
  p_user_id UUID,
  p_session_id UUID
)
RETURNS TABLE (
  payment_id UUID,
  session_id UUID,
  amount NUMERIC,
  gst_amount NUMERIC,
  total_amount NUMERIC,
  status TEXT,
  amount_due NUMERIC,
  gateway_order_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_sess RECORD;
  v_is_prepaid BOOLEAN := false;
BEGIN
  SELECT
    s.payment_mode,
    s.payment_status,
    s.prepaid_mode,
    s.prepaid_total_inr,
    s.amount_due
  INTO v_sess
  FROM "EV_ChargingSessions" s
  WHERE s.id = p_session_id
    AND s.user_id = p_user_id;

  IF FOUND THEN
    v_is_prepaid :=
      lower(COALESCE(v_sess.payment_mode, '')) = 'prepaid'
      OR COALESCE(v_sess.prepaid_mode, '') IN ('amount', 'time')
      OR COALESCE(v_sess.prepaid_total_inr, 0) > 0
      OR lower(COALESCE(v_sess.payment_status, '')) = 'paid';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.session_id,
    p.amount,
    p.gst_amount,
    p.total_amount,
    p.status,
    CASE
      WHEN v_is_prepaid THEN 0::numeric
      WHEN p.status IN ('success', 'paid') THEN 0::numeric
      WHEN v_sess.amount_due IS NOT NULL THEN COALESCE(v_sess.amount_due, 0)
      ELSE p.total_amount
    END,
    CASE
      WHEN p.gateway = 'razorpay' AND p.status = 'pending' THEN p.gateway_txn_id
      ELSE NULL::text
    END
  FROM "EV_Payments" p
  WHERE p.session_id = p_session_id
    AND p.user_id = p_user_id
  ORDER BY
    CASE WHEN p.status IN ('success', 'paid') THEN 0 ELSE 1 END,
    p.created_at DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION ev_get_session_payment(UUID, UUID) TO anon, authenticated;

-- =============================================================================
-- On Razorpay success: mark session prepaid/paid, amount_due = 0
-- =============================================================================

CREATE OR REPLACE FUNCTION ev_complete_session_razorpay_payment(
  p_user_id UUID,
  p_payment_id UUID,
  p_gateway_order_id TEXT,
  p_gateway_payment_id TEXT
)
RETURNS TABLE (
  payment_id UUID,
  session_id UUID,
  amount NUMERIC,
  status TEXT,
  receipt_number TEXT,
  gateway_order_id TEXT,
  gateway_payment_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_payment RECORD;
  v_receipt_number TEXT;
BEGIN
  SELECT p.*
  INTO v_payment
  FROM "EV_Payments" p
  WHERE p.id = p_payment_id
    AND p.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
  END IF;

  IF v_payment.status IN ('success', 'paid') THEN
    UPDATE "EV_ChargingSessions"
    SET
      payment_mode = COALESCE(payment_mode, 'prepaid'),
      payment_status = 'paid',
      payment_id = COALESCE(payment_id, v_payment.id),
      prepaid_payment_id = COALESCE(prepaid_payment_id, v_payment.id),
      amount_due = 0,
      updated_at = NOW()
    WHERE id = v_payment.session_id
      AND user_id = p_user_id;

    SELECT r.receipt_number
    INTO v_receipt_number
    FROM "EV_Receipts" r
    WHERE r.payment_id = v_payment.id
    LIMIT 1;

    RETURN QUERY
    SELECT
      v_payment.id,
      v_payment.session_id,
      v_payment.amount,
      v_payment.status,
      v_receipt_number,
      COALESCE(v_payment.gateway_txn_id, p_gateway_order_id),
      COALESCE(v_payment.gateway_txn_id, p_gateway_payment_id);
    RETURN;
  END IF;

  IF v_payment.gateway_txn_id IS NOT NULL
     AND v_payment.gateway_txn_id <> p_gateway_order_id THEN
    RAISE EXCEPTION 'GATEWAY_ORDER_MISMATCH';
  END IF;

  UPDATE "EV_Payments"
  SET
    status = 'success',
    gateway = 'razorpay',
    gateway_txn_id = p_gateway_payment_id,
    reconciliation_status = 'matched',
    payment_kind = COALESCE(payment_kind, 'prepaid'),
    updated_at = NOW()
  WHERE id = p_payment_id;

  UPDATE "EV_ChargingSessions"
  SET
    payment_mode = COALESCE(payment_mode, 'prepaid'),
    payment_status = 'paid',
    payment_id = v_payment.id,
    prepaid_payment_id = COALESCE(prepaid_payment_id, v_payment.id),
    amount_due = 0,
    settlement_status = COALESCE(settlement_status, 'active'),
    updated_at = NOW()
  WHERE id = v_payment.session_id
    AND user_id = p_user_id;

  SELECT r.receipt_number
  INTO v_receipt_number
  FROM "EV_Receipts" r
  WHERE r.payment_id = p_payment_id
  LIMIT 1;

  IF v_receipt_number IS NULL THEN
    v_receipt_number := 'RCP-' || UPPER(SUBSTRING(REPLACE(p_payment_id::text, '-', ''), 1, 8))
      || '-' || UPPER(TO_CHAR(NOW(), 'YYMMDDHH24MI'));
    INSERT INTO "EV_Receipts" (payment_id, receipt_number, pdf_url)
    VALUES (
      p_payment_id,
      v_receipt_number,
      'https://ev-cms.dfccil.gov.in/receipts/' || v_receipt_number || '.pdf'
    );
  END IF;

  RETURN QUERY
  SELECT
    p_payment_id,
    v_payment.session_id,
    v_payment.total_amount,
    'success'::text,
    v_receipt_number,
    p_gateway_order_id,
    p_gateway_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION ev_complete_session_razorpay_payment(UUID, UUID, TEXT, TEXT)
  TO anon, authenticated, service_role;

-- =============================================================================
-- Stop session: prepaid → no second pending payment / no Pay CTA notification
-- =============================================================================

CREATE OR REPLACE FUNCTION ev_sim_stop_session(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_bill RECORD;
  v_is_prepaid BOOLEAN := false;
  v_has_paid BOOLEAN := false;
BEGIN
  SELECT s.*
  INTO v_sess
  FROM "EV_ChargingSessions" s
  WHERE s.id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  v_is_prepaid :=
    lower(COALESCE(v_sess.payment_mode, '')) = 'prepaid'
    OR COALESCE(v_sess.prepaid_mode, '') IN ('amount', 'time')
    OR COALESCE(v_sess.prepaid_total_inr, 0) > 0
    OR lower(COALESCE(v_sess.payment_status, '')) = 'paid';

  SELECT EXISTS (
    SELECT 1
    FROM "EV_Payments" p
    WHERE p.session_id = p_session_id
      AND p.status IN ('success', 'paid')
  ) INTO v_has_paid;

  SELECT *
  INTO v_bill
  FROM ev_calculate_session_bill(COALESCE(v_sess.energy_kwh, 0), v_sess.tariff_id)
  LIMIT 1;

  IF v_is_prepaid OR v_has_paid THEN
    UPDATE "EV_ChargingSessions"
    SET
      status = 'completed',
      end_time = NOW(),
      amount = v_bill.amount,
      current_power_kw = 0,
      stop_reason = 'Local',
      payment_mode = COALESCE(payment_mode, 'prepaid'),
      payment_status = 'paid',
      amount_due = 0,
      settlement_status = COALESCE(settlement_status, 'settled'),
      settlement_amount = COALESCE(prepaid_total_inr, prepaid_amount, 0),
      updated_at = NOW()
    WHERE id = p_session_id;

    -- Keep existing paid prepaid payment; never insert a second pending bill.
    UPDATE "EV_Payments"
    SET
      payment_kind = COALESCE(payment_kind, 'prepaid'),
      updated_at = NOW()
    WHERE session_id = p_session_id
      AND status IN ('success', 'paid');

    PERFORM ev_sim_log_event(
      v_sess.charger_id, v_sess.connector_id, 'StopTransaction',
      jsonb_build_object('sessionId', p_session_id, 'prepaid', true, 'amount', COALESCE(v_sess.prepaid_total_inr, 0))
    );

    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_sess.user_id, 'Remote Stop', 'Session', p_session_id::text, 'Simulator StopTransaction (prepaid — no post-pay)');

    PERFORM ev_notify_user(
      v_sess.user_id,
      'Charging Completed',
      'Payment already received via prepaid plan.',
      'charging_stopped'
    );
  ELSE
    UPDATE "EV_ChargingSessions"
    SET
      status = 'completed',
      end_time = NOW(),
      amount = v_bill.amount,
      current_power_kw = 0,
      stop_reason = 'Local',
      payment_mode = COALESCE(payment_mode, 'postpaid'),
      payment_status = COALESCE(payment_status, 'pending'),
      amount_due = v_bill.total_amount,
      updated_at = NOW()
    WHERE id = p_session_id;

    INSERT INTO "EV_Payments" (session_id, user_id, amount, gst_amount, total_amount, status, gateway, reconciliation_status, payment_kind)
    VALUES (
      p_session_id, v_sess.user_id, v_bill.amount, v_bill.gst_amount, v_bill.total_amount,
      'pending', 'razorpay', 'unmatched', 'prepaid'
    );

    PERFORM ev_sim_log_event(
      v_sess.charger_id, v_sess.connector_id, 'StopTransaction',
      jsonb_build_object('sessionId', p_session_id, 'amount', v_bill.total_amount)
    );

    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_sess.user_id, 'Remote Stop', 'Session', p_session_id::text, 'Simulator StopTransaction');

    PERFORM ev_notify_user(
      v_sess.user_id,
      'Charging completed',
      'Session finished. Pay ₹' || ROUND(v_bill.total_amount, 2)::text || ' to complete your session.',
      'charging_stopped'
    );
  END IF;

  UPDATE "EV_ChargerConnectors"
  SET status = 'Available', updated_at = NOW()
  WHERE charger_id = v_sess.charger_id AND connector_id = v_sess.connector_id;

  UPDATE "EV_Chargers"
  SET status = 'online', last_status_change_at = NOW(), last_heartbeat_at = NOW(), updated_at = NOW()
  WHERE id = v_sess.charger_id;

  UPDATE "EV_Notifications" n
  SET reference_type = 'charging_session', reference_id = p_session_id
  WHERE n.id = (
    SELECT id FROM "EV_Notifications"
    WHERE user_id = v_sess.user_id AND type = 'charging_stopped'
    ORDER BY created_at DESC
    LIMIT 1
  );
END;
$$;

GRANT EXECUTE ON FUNCTION ev_sim_stop_session(UUID) TO anon, authenticated;


-- =============================================================================
-- FILE: supabase/charger_tariff.sql
-- =============================================================================

-- Per-charger tariff override (run on VBDC Supabase after schema.sql)
-- NULL tariff_id = use active type default (DC Fast / AC Slow)

ALTER TABLE "EV_Chargers"
  ADD COLUMN IF NOT EXISTS tariff_id UUID REFERENCES "EV_Tariffs"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ev_chargers_tariff_id ON "EV_Chargers" (tariff_id);

COMMENT ON COLUMN "EV_Chargers".tariff_id IS 'Optional tariff override; NULL uses active EV_Tariffs by charger_type';


-- =============================================================================
-- FILE: supabase/charger_display_name.sql
-- =============================================================================

-- Optional display label for chargers (web + mobile share the same source of truth).
-- Do NOT auto-fill with generated names — leave NULL; fall back to name / charge_point_id in app code.

ALTER TABLE public."EV_Chargers"
  ADD COLUMN IF NOT EXISTS display_name TEXT;

COMMENT ON COLUMN public."EV_Chargers".display_name IS
  'Optional public label. If empty, apps show name, then charge_point_id.';


-- =============================================================================
-- FILE: supabase/users_joined_date.sql
-- =============================================================================

-- Optional joining date on user create/edit (maps to EV_Users.created_at / admin "Joined" column).
-- Run on VBDC after policies_write.sql

CREATE OR REPLACE FUNCTION create_ev_user(
  p_email TEXT,
  p_full_name TEXT,
  p_role TEXT,
  p_department TEXT DEFAULT 'Operations',
  p_joined_date DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_db_role TEXT;
BEGIN
  v_db_role := CASE
    WHEN p_role IN ('Admin', 'SuperAdmin') THEN 'SuperAdmin'
    WHEN p_role = 'SiteAdmin' THEN 'SiteAdmin'
    WHEN p_role IN ('User', 'Operator', 'Viewer') THEN 'Operator'
    ELSE 'Operator'
  END;

  INSERT INTO "EV_Users" (email, password_hash, salt, full_name, role, department, status, created_at)
  VALUES (
    lower(trim(p_email)),
    '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4',
    'ev_salt_2026',
    trim(p_full_name),
    v_db_role,
    COALESCE(NULLIF(trim(p_department), ''), 'Operations'),
    'active',
    COALESCE(p_joined_date::timestamptz, NOW())
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION update_ev_user(
  p_id UUID,
  p_email TEXT,
  p_full_name TEXT,
  p_role TEXT,
  p_department TEXT,
  p_joined_date DATE DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_db_role TEXT;
BEGIN
  v_db_role := CASE
    WHEN p_role IN ('Admin', 'SuperAdmin') THEN 'SuperAdmin'
    WHEN p_role = 'SiteAdmin' THEN 'SiteAdmin'
    WHEN p_role IN ('User', 'Operator', 'Viewer') THEN 'Operator'
    ELSE 'Operator'
  END;

  UPDATE "EV_Users"
  SET
    email = lower(trim(p_email)),
    full_name = trim(p_full_name),
    role = v_db_role,
    department = COALESCE(NULLIF(trim(p_department), ''), department),
    created_at = COALESCE(p_joined_date::timestamptz, created_at),
    updated_at = NOW()
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_ev_user(TEXT, TEXT, TEXT, TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_ev_user(UUID, TEXT, TEXT, TEXT, TEXT, DATE) TO anon, authenticated;


-- =============================================================================
-- FILE: supabase/users_status.sql
-- =============================================================================

-- User status on create/edit (active | inactive).
-- Run on VBDC after users_joined_date.sql

CREATE OR REPLACE FUNCTION create_ev_user(
  p_email TEXT,
  p_full_name TEXT,
  p_role TEXT,
  p_department TEXT DEFAULT 'Operations',
  p_joined_date DATE DEFAULT NULL,
  p_status TEXT DEFAULT 'active'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_db_role TEXT;
  v_status TEXT;
BEGIN
  v_db_role := CASE
    WHEN p_role IN ('Admin', 'SuperAdmin') THEN 'SuperAdmin'
    WHEN p_role = 'SiteAdmin' THEN 'SiteAdmin'
    WHEN p_role IN ('User', 'Operator', 'Viewer') THEN 'Operator'
    ELSE 'Operator'
  END;

  v_status := CASE
    WHEN lower(trim(COALESCE(p_status, ''))) = 'inactive' THEN 'inactive'
    ELSE 'active'
  END;

  INSERT INTO "EV_Users" (email, password_hash, salt, full_name, role, department, status, created_at)
  VALUES (
    lower(trim(p_email)),
    '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4',
    'ev_salt_2026',
    trim(p_full_name),
    v_db_role,
    COALESCE(NULLIF(trim(p_department), ''), 'Operations'),
    v_status,
    COALESCE(p_joined_date::timestamptz, NOW())
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION update_ev_user(
  p_id UUID,
  p_email TEXT,
  p_full_name TEXT,
  p_role TEXT,
  p_department TEXT,
  p_joined_date DATE DEFAULT NULL,
  p_status TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_db_role TEXT;
  v_status TEXT;
BEGIN
  v_db_role := CASE
    WHEN p_role IN ('Admin', 'SuperAdmin') THEN 'SuperAdmin'
    WHEN p_role = 'SiteAdmin' THEN 'SiteAdmin'
    WHEN p_role IN ('User', 'Operator', 'Viewer') THEN 'Operator'
    ELSE 'Operator'
  END;

  v_status := CASE
    WHEN lower(trim(COALESCE(p_status, ''))) = 'inactive' THEN 'inactive'
    WHEN lower(trim(COALESCE(p_status, ''))) = 'active' THEN 'active'
    ELSE NULL
  END;

  UPDATE "EV_Users"
  SET
    email = lower(trim(p_email)),
    full_name = trim(p_full_name),
    role = v_db_role,
    department = COALESCE(NULLIF(trim(p_department), ''), department),
    created_at = COALESCE(p_joined_date::timestamptz, created_at),
    status = COALESCE(v_status, status),
    updated_at = NOW()
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_ev_user(TEXT, TEXT, TEXT, TEXT, DATE, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_ev_user(UUID, TEXT, TEXT, TEXT, TEXT, DATE, TEXT) TO anon, authenticated;


-- =============================================================================
-- FILE: supabase/support_tickets_admin.sql
-- =============================================================================

-- Admin web: allow status / priority / assignee updates on support tickets (demo anon key).
-- Production: use service role API or authenticated admin roles.

DROP POLICY IF EXISTS "ev_anon_update_support_tickets" ON "EV_SupportTickets";
CREATE POLICY "ev_anon_update_support_tickets" ON "EV_SupportTickets"
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);


-- =============================================================================
-- FILE: supabase/phase0_mobile_support_insert.sql
-- =============================================================================

DROP POLICY IF EXISTS "ev_anon_insert_support" ON "EV_SupportTickets";
CREATE POLICY "ev_anon_insert_support" ON "EV_SupportTickets"
  FOR INSERT TO anon, authenticated WITH CHECK (true);


-- =============================================================================
-- FILE: supabase/ev_system_config.sql
-- =============================================================================

-- Internal config (RLS enabled, no policies — service role + SECURITY DEFINER only).
CREATE TABLE IF NOT EXISTS "EV_SystemConfig" (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "EV_SystemConfig" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION ev_get_system_config(p_key TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT value FROM "EV_SystemConfig" WHERE key = p_key LIMIT 1;
$$;

-- Set push dispatch secret (must match what the edge function validates):
-- INSERT INTO "EV_SystemConfig" (key, value) VALUES ('ev_push_dispatch_secret', 'your-secret')
-- ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();


-- =============================================================================
-- FILE: supabase/payment_gateway_config.sql
-- =============================================================================

-- Dynamic payment gateway config (Razorpay test / HDFC production).
-- Safe to re-run. Does not delete existing EV_SystemConfig rows.
-- Default: testing_mode = true → Razorpay (current testing continues).

-- ---------------------------------------------------------------------------
-- 1) System config table (compatible with existing key/value schema)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."EV_SystemConfig" (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public."EV_SystemConfig"
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public."EV_SystemConfig" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.ev_get_system_config(p_key TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT value FROM public."EV_SystemConfig"
  WHERE key = p_key AND COALESCE(is_active, true) = true
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 2) payment_gateway config row (default testing_mode = true → Razorpay)
-- ---------------------------------------------------------------------------
INSERT INTO public."EV_SystemConfig" (key, value, description, is_active, updated_at)
VALUES (
  'payment_gateway',
  '{"testing_mode":true,"test_gateway":"razorpay","production_gateway":"hdfc","active_currency":"INR","gst_enabled":true}'::text,
  'Active payment gateway: testing_mode true = Razorpay, false = HDFC',
  true,
  NOW()
)
ON CONFLICT (key) DO UPDATE
SET
  description = COALESCE(EXCLUDED.description, public."EV_SystemConfig".description),
  is_active = true,
  updated_at = CASE
    WHEN public."EV_SystemConfig".value IS NULL OR public."EV_SystemConfig".value = ''
    THEN NOW()
    ELSE public."EV_SystemConfig".updated_at
  END,
  value = CASE
    WHEN public."EV_SystemConfig".value IS NULL OR public."EV_SystemConfig".value = ''
    THEN EXCLUDED.value
    ELSE public."EV_SystemConfig".value
  END;

-- Ensure required JSON keys exist without wiping admin changes
UPDATE public."EV_SystemConfig"
SET value = (
  COALESCE(value::jsonb, '{}'::jsonb)
  || jsonb_build_object(
    'testing_mode', COALESCE((value::jsonb)->>'testing_mode', 'true')::boolean,
    'test_gateway', COALESCE((value::jsonb)->>'test_gateway', 'razorpay'),
    'production_gateway', COALESCE((value::jsonb)->>'production_gateway', 'hdfc'),
    'active_currency', COALESCE((value::jsonb)->>'active_currency', 'INR'),
    'gst_enabled', COALESCE(((value::jsonb)->>'gst_enabled')::boolean, true)
  )
)::text,
  updated_at = NOW()
WHERE key = 'payment_gateway'
  AND (
    value IS NULL
    OR value = ''
    OR NOT (value::jsonb ? 'testing_mode')
    OR NOT (value::jsonb ? 'test_gateway')
    OR NOT (value::jsonb ? 'production_gateway')
  );

-- ---------------------------------------------------------------------------
-- 3) Payment table gateway snapshot columns
-- ---------------------------------------------------------------------------
ALTER TABLE public."EV_PaymentOrders"
  ADD COLUMN IF NOT EXISTS gateway TEXT,
  ADD COLUMN IF NOT EXISTS gateway_order_id TEXT,
  ADD COLUMN IF NOT EXISTS testing_mode BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS raw_gateway_response JSONB;

ALTER TABLE public."EV_PaymentTransactions"
  ADD COLUMN IF NOT EXISTS gateway TEXT,
  ADD COLUMN IF NOT EXISTS gateway_order_id TEXT,
  ADD COLUMN IF NOT EXISTS gateway_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS gateway_signature TEXT,
  ADD COLUMN IF NOT EXISTS gateway_status TEXT,
  ADD COLUMN IF NOT EXISTS testing_mode BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS raw_gateway_response JSONB;

ALTER TABLE public."EV_Payments"
  ADD COLUMN IF NOT EXISTS gateway TEXT,
  ADD COLUMN IF NOT EXISTS gateway_order_id TEXT,
  ADD COLUMN IF NOT EXISTS gateway_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS testing_mode BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS raw_gateway_response JSONB;

-- Backfill gateway from gateway_name where present
UPDATE public."EV_PaymentOrders"
SET gateway = COALESCE(gateway, gateway_name)
WHERE gateway IS NULL AND gateway_name IS NOT NULL;

UPDATE public."EV_PaymentTransactions"
SET gateway = COALESCE(gateway, gateway_name)
WHERE gateway IS NULL AND gateway_name IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) Public + admin RPCs (no secrets)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ev_parse_payment_gateway_config(p_raw TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v JSONB;
  testing_mode BOOLEAN;
  test_gw TEXT;
  prod_gw TEXT;
BEGIN
  BEGIN
    v := COALESCE(p_raw::jsonb, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v := '{}'::jsonb;
  END;

  testing_mode := COALESCE((v->>'testing_mode')::boolean, true);
  test_gw := lower(COALESCE(v->>'test_gateway', 'razorpay'));
  prod_gw := lower(COALESCE(v->>'production_gateway', 'hdfc'));

  RETURN jsonb_build_object(
    'testing_mode', testing_mode,
    'test_gateway', test_gw,
    'production_gateway', prod_gw,
    'active_gateway', CASE WHEN testing_mode THEN test_gw ELSE prod_gw END,
    'active_currency', COALESCE(v->>'active_currency', 'INR'),
    'gst_enabled', COALESCE((v->>'gst_enabled')::boolean, true)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ev_get_payment_gateway_public()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_raw TEXT;
BEGIN
  SELECT value INTO v_raw
  FROM public."EV_SystemConfig"
  WHERE key = 'payment_gateway' AND COALESCE(is_active, true) = true
  LIMIT 1;

  RETURN public.ev_parse_payment_gateway_config(v_raw);
END;
$$;

CREATE OR REPLACE FUNCTION public.ev_get_payment_gateway_config()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN public.ev_get_payment_gateway_public();
END;
$$;

CREATE OR REPLACE FUNCTION public.ev_set_payment_gateway_testing_mode(
  p_admin_user_id UUID,
  p_testing_mode BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_raw TEXT;
  v_cfg JSONB;
  v_next JSONB;
BEGIN
  IF p_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'Admin user required';
  END IF;

  SELECT role INTO v_role FROM public."EV_Users" WHERE id = p_admin_user_id;
  IF v_role IS NULL OR v_role NOT IN ('SuperAdmin', 'Admin') THEN
    RAISE EXCEPTION 'Only SuperAdmin can change payment gateway mode';
  END IF;

  SELECT value INTO v_raw
  FROM public."EV_SystemConfig"
  WHERE key = 'payment_gateway'
  LIMIT 1;

  v_cfg := public.ev_parse_payment_gateway_config(v_raw);
  v_next := v_cfg || jsonb_build_object(
    'testing_mode', COALESCE(p_testing_mode, true),
    'test_gateway', 'razorpay',
    'production_gateway', 'hdfc'
  );
  v_next := v_next || jsonb_build_object(
    'active_gateway',
    CASE WHEN COALESCE(p_testing_mode, true)
      THEN 'razorpay'
      ELSE 'hdfc'
    END
  );

  INSERT INTO public."EV_SystemConfig" (key, value, description, is_active, updated_at)
  VALUES (
    'payment_gateway',
    v_next::text,
    'Active payment gateway: testing_mode true = Razorpay, false = HDFC',
    true,
    NOW()
  )
  ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      description = EXCLUDED.description,
      is_active = true,
      updated_at = NOW();

  INSERT INTO public."EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (
    p_admin_user_id,
    CASE WHEN COALESCE(p_testing_mode, true) THEN 'Enabled Payment Testing Mode' ELSE 'Disabled Payment Testing Mode' END,
    'SystemConfig',
    'payment_gateway',
    format(
      'Payment testing_mode=%s active_gateway=%s',
      COALESCE(p_testing_mode, true),
      CASE WHEN COALESCE(p_testing_mode, true) THEN 'razorpay' ELSE 'hdfc' END
    )
  );

  RETURN public.ev_get_payment_gateway_public();
END;
$$;

GRANT EXECUTE ON FUNCTION public.ev_get_payment_gateway_public() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ev_get_payment_gateway_config() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ev_set_payment_gateway_testing_mode(UUID, BOOLEAN) TO anon, authenticated;

COMMENT ON FUNCTION public.ev_get_payment_gateway_public() IS
  'Safe payment gateway config for mobile/web (no secrets). testing_mode true = Razorpay.';
COMMENT ON FUNCTION public.ev_set_payment_gateway_testing_mode(UUID, BOOLEAN) IS
  'SuperAdmin-only toggle. true = Razorpay testing, false = HDFC production.';


-- =============================================================================
-- FILE: supabase/email_change_otp.sql
-- =============================================================================

-- Email change OTP verification (run on Supabase after profile_and_storage.sql)

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS "EV_EmailChangeOtps" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "EV_Users"(id) ON DELETE CASCADE,
  new_email TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ev_email_change_otps_user_id ON "EV_EmailChangeOtps" (user_id);
CREATE INDEX IF NOT EXISTS idx_ev_email_change_otps_expires_at ON "EV_EmailChangeOtps" (expires_at);

ALTER TABLE "EV_EmailChangeOtps" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ev_anon_email_otp" ON "EV_EmailChangeOtps"
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Returns a 6-digit OTP for the app to email via Power Automate (valid 10 minutes).
CREATE OR REPLACE FUNCTION create_ev_email_change_otp(p_user_id UUID, p_new_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_otp TEXT;
  v_hash TEXT;
  v_new_email TEXT;
BEGIN
  v_new_email := lower(trim(p_new_email));
  IF v_new_email IS NULL OR v_new_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "EV_Users" WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "EV_Users"
    WHERE lower(email) = v_new_email AND id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'Email is already in use by another account';
  END IF;

  DELETE FROM "EV_EmailChangeOtps" WHERE user_id = p_user_id;

  v_otp := lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_hash := encode(digest(v_otp || 'ev_email_otp_2026', 'sha256'), 'hex');

  INSERT INTO "EV_EmailChangeOtps" (user_id, new_email, otp_hash, expires_at)
  VALUES (p_user_id, v_new_email, v_hash, NOW() + INTERVAL '10 minutes');

  RETURN v_otp;
END;
$$;

CREATE OR REPLACE FUNCTION verify_ev_email_change_otp(
  p_user_id UUID,
  p_new_email TEXT,
  p_otp TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash TEXT;
  v_row "EV_EmailChangeOtps"%ROWTYPE;
BEGIN
  v_hash := encode(digest(trim(p_otp) || 'ev_email_otp_2026', 'sha256'), 'hex');

  SELECT * INTO v_row
  FROM "EV_EmailChangeOtps"
  WHERE user_id = p_user_id
    AND lower(new_email) = lower(trim(p_new_email))
    AND otp_hash = v_hash
    AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  DELETE FROM "EV_EmailChangeOtps" WHERE id = v_row.id;
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION create_ev_email_change_otp(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_ev_email_change_otp(UUID, TEXT, TEXT) TO anon, authenticated;


-- =============================================================================
-- FILE: supabase/web_push_dispatch.sql
-- =============================================================================

-- Dispatch mobile (Expo) and web (FCM) push when a notification row is inserted.
-- Prerequisite: deploy send-push-notification edge function + set secrets (see WEB_PUSH_SETUP.md).

CREATE OR REPLACE FUNCTION ev_dispatch_push_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT := 'https://fvveqziyusjgqejowkfp.supabase.co/functions/v1/send-push-notification';
  v_secret TEXT;
BEGIN
  IF NEW.push_sent = true THEN
    RETURN NEW;
  END IF;

  v_secret := ev_get_system_config('ev_push_dispatch_secret');
  IF v_secret IS NULL OR v_secret = '' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ev-push-secret', v_secret
    ),
    body := jsonb_build_object('notificationId', NEW.id)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ev_notifications_dispatch_push ON "EV_Notifications";
CREATE TRIGGER ev_notifications_dispatch_push
  AFTER INSERT ON "EV_Notifications"
  FOR EACH ROW
  EXECUTE FUNCTION ev_dispatch_push_notification();

-- Secret is stored in EV_SystemConfig (see supabase/ev_system_config.sql).
-- Optional override: EV_PUSH_DISPATCH_SECRET edge function secret.


-- =============================================================================
-- FILE: supabase/rfid_one_per_user.sql
-- =============================================================================

-- One RFID card ↔ one user (at most one active binding each).
-- Run on VBDC after policies_write.sql

-- Keep oldest binding per user; unbind duplicates before unique index.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC, id ASC) AS rn
  FROM "EV_RFIDCards"
  WHERE user_id IS NOT NULL
)
UPDATE "EV_RFIDCards" c
SET user_id = NULL,
    status = CASE WHEN c.status = 'blocked' THEN 'blocked' ELSE 'inactive' END,
    updated_at = NOW()
FROM ranked r
WHERE c.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_rfid_cards_one_user
  ON "EV_RFIDCards" (user_id)
  WHERE user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION bind_ev_rfid_to_user(p_card_id UUID, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card "EV_RFIDCards"%ROWTYPE;
BEGIN
  IF p_card_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'Card and user are required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "EV_Users" u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT * INTO v_card FROM "EV_RFIDCards" WHERE id = p_card_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RFID card not found';
  END IF;

  IF v_card.status = 'blocked' THEN
    RAISE EXCEPTION 'Cannot bind a blocked RFID card';
  END IF;

  IF v_card.user_id IS NOT NULL AND v_card.user_id <> p_user_id THEN
    RAISE EXCEPTION 'This RFID is already assigned to another user';
  END IF;

  -- Remove any other card from this user (1 user → 1 RFID).
  UPDATE "EV_RFIDCards"
  SET user_id = NULL,
      status = CASE WHEN status = 'blocked' THEN 'blocked' ELSE 'inactive' END,
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND id <> p_card_id;

  UPDATE "EV_RFIDCards"
  SET user_id = p_user_id,
      status = 'active',
      updated_at = NOW()
  WHERE id = p_card_id;
END;
$$;

GRANT EXECUTE ON FUNCTION bind_ev_rfid_to_user(UUID, UUID) TO anon, authenticated;


-- =============================================================================
-- FILE: supabase/mobile_policies.sql
-- =============================================================================

-- Mobile app policies (P0) — run after schema.sql + rls.sql + policies_write.sql
-- Same content as mobile/SUPABASE_MOBILE_POLICIES.sql (kept in sync).

DROP POLICY IF EXISTS "ev_anon_insert_sessions" ON "EV_ChargingSessions";
CREATE POLICY "ev_anon_insert_sessions" ON "EV_ChargingSessions"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_update_sessions" ON "EV_ChargingSessions";
CREATE POLICY "ev_anon_update_sessions" ON "EV_ChargingSessions"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_insert_support" ON "EV_SupportTickets";
CREATE POLICY "ev_anon_insert_support" ON "EV_SupportTickets"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- FCM / Expo push token registry (mobile registers after login)
CREATE TABLE IF NOT EXISTS "EV_UserPushTokens" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "EV_Users"(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_ev_push_tokens_user ON "EV_UserPushTokens" (user_id);

ALTER TABLE "EV_UserPushTokens" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ev_anon_manage_push_tokens" ON "EV_UserPushTokens";
CREATE POLICY "ev_anon_manage_push_tokens" ON "EV_UserPushTokens"
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON "EV_UserPushTokens" TO anon, authenticated;

-- Mobile avatar uploads (ev-media bucket)
DROP POLICY IF EXISTS "ev_media_public_read" ON storage.objects;
CREATE POLICY "ev_media_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'ev-media');

DROP POLICY IF EXISTS "ev_media_anon_upload" ON storage.objects;
CREATE POLICY "ev_media_anon_upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'ev-media' AND (storage.foldername(name))[1] = 'EV');

DROP POLICY IF EXISTS "ev_media_anon_update" ON storage.objects;
CREATE POLICY "ev_media_anon_update" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'ev-media')
  WITH CHECK (bucket_id = 'ev-media');

DROP POLICY IF EXISTS "ev_media_anon_delete" ON storage.objects;
CREATE POLICY "ev_media_anon_delete" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'ev-media');

-- Seed charger coordinates for nearest-charger map (safe to re-run)
UPDATE "EV_Chargers" SET latitude = 28.6145, longitude = 77.2085 WHERE charge_point_id = 'MP-DC-001';
UPDATE "EV_Chargers" SET latitude = 28.6148, longitude = 77.2092 WHERE charge_point_id = 'MP-DC-002';
UPDATE "EV_Chargers" SET latitude = 19.0765, longitude = 72.8785 WHERE charge_point_id = 'MP-DC-003';
UPDATE "EV_Chargers" SET latitude = 19.0770, longitude = 72.8790 WHERE charge_point_id = 'MP-DC-004';
UPDATE "EV_Chargers" SET latitude = 28.6120, longitude = 77.2050 WHERE charge_point_id = 'MP-AC-001';
UPDATE "EV_Chargers" SET latitude = 28.6125, longitude = 77.2055 WHERE charge_point_id = 'MP-AC-002';
UPDATE "EV_Chargers" SET latitude = 28.6130, longitude = 77.2060 WHERE charge_point_id = 'MP-AC-003';
UPDATE "EV_Chargers" SET latitude = 13.0830, longitude = 80.2710 WHERE charge_point_id = 'MP-AC-004';
UPDATE "EV_Chargers" SET latitude = 13.0835, longitude = 80.2715 WHERE charge_point_id = 'MP-AC-005';
UPDATE "EV_Chargers" SET latitude = 13.0840, longitude = 80.2720 WHERE charge_point_id = 'MP-AC-006';
UPDATE "EV_Chargers" SET latitude = 22.5730, longitude = 88.3640 WHERE charge_point_id = 'TS-DC-001';
UPDATE "EV_Chargers" SET latitude = 22.5735, longitude = 88.3645 WHERE charge_point_id = 'TS-AC-001';


-- =============================================================================
-- FILE: supabase/mobile_charger_online_gate.sql
-- =============================================================================

-- Mobile-only charger online gate for start charging / prepaid payment.
-- Does NOT change admin web RemoteStart / OCPP flows.
-- Run in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION ev_mobile_assert_charger_online(p_charger_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT lower(trim(COALESCE(status, '')))
  INTO v_status
  FROM "EV_Chargers"
  WHERE id = p_charger_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHARGER_NOT_FOUND';
  END IF;

  IF v_status IS NULL OR v_status = '' OR v_status NOT IN ('online', 'available') THEN
    RAISE EXCEPTION 'Charger is not online. Please select another charger.';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION ev_mobile_assert_charger_online(UUID) TO anon, authenticated;

COMMENT ON FUNCTION ev_mobile_assert_charger_online(UUID) IS
  'Mobile app only: reject session/payment start unless EV_Chargers.status is online or available.';


-- =============================================================================
-- FILE: supabase/fix_session_payment_columns.sql
-- =============================================================================

-- Fix: EV_ChargingSessions missing prepaid/payment columns (amount_due, etc.)
-- Run once in Supabase SQL Editor.

ALTER TABLE "EV_ChargingSessions"
  ADD COLUMN IF NOT EXISTS payment_mode TEXT,
  ADD COLUMN IF NOT EXISTS prepaid_type TEXT,
  ADD COLUMN IF NOT EXISTS payment_status TEXT,
  ADD COLUMN IF NOT EXISTS payment_id UUID,
  ADD COLUMN IF NOT EXISTS prepaid_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS prepaid_duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS amount_due NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prepaid_mode TEXT,
  ADD COLUMN IF NOT EXISTS prepaid_value NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS prepaid_total_inr NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS prepaid_energy_cap_kwh NUMERIC(12, 3),
  ADD COLUMN IF NOT EXISTS prepaid_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prepaid_payment_id UUID,
  ADD COLUMN IF NOT EXISTS prepaid_plan_id UUID,
  ADD COLUMN IF NOT EXISTS settlement_status TEXT,
  ADD COLUMN IF NOT EXISTS settlement_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS target_kwh NUMERIC(12, 3),
  ADD COLUMN IF NOT EXISTS authorization_method TEXT,
  ADD COLUMN IF NOT EXISTS rate_per_kwh_snapshot NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS session_fee_snapshot NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS gst_percent_snapshot NUMERIC(5, 2);

COMMENT ON COLUMN "EV_ChargingSessions".rate_per_kwh_snapshot IS
  'Tariff rate at prepaid purchase time (₹/kWh)';
COMMENT ON COLUMN "EV_ChargingSessions".session_fee_snapshot IS
  'Session fee at prepaid purchase time';
COMMENT ON COLUMN "EV_ChargingSessions".gst_percent_snapshot IS
  'GST percent at prepaid purchase time';

COMMENT ON COLUMN "EV_ChargingSessions".amount_due IS
  'Post-session amount still owed; must stay 0 for prepaid sessions';


-- =============================================================================
-- FILE: supabase/fix_password_digest.sql
-- =============================================================================

-- Fix: "function digest(text, unknown) does not exist" on password change / login
-- Supabase installs pgcrypto in the "extensions" schema — SECURITY DEFINER RPCs
-- with search_path = public cannot see digest() unless we include extensions.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.ev_password_hash(p_password TEXT, p_salt TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT encode(digest(p_password || p_salt, 'sha256'::text), 'hex');
$$;

GRANT EXECUTE ON FUNCTION public.ev_password_hash(TEXT, TEXT) TO anon, authenticated;

-- Re-create login (matches profile_and_storage.sql return columns if you already ran it)
DROP FUNCTION IF EXISTS verify_ev_login(TEXT, TEXT);

CREATE OR REPLACE FUNCTION verify_ev_login(p_email TEXT, p_password TEXT)
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  role TEXT,
  department TEXT,
  status TEXT,
  phone TEXT,
  avatar_url TEXT,
  employee_id TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_user "EV_Users"%ROWTYPE;
BEGIN
  SELECT * INTO v_user
  FROM "EV_Users" u
  WHERE lower(u.email) = lower(trim(p_email));

  IF NOT FOUND THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (NULL, 'login_failed', 'auth', lower(trim(p_email)), 'Unknown email');
    RETURN;
  END IF;

  IF v_user.status <> 'active' THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_user.id, 'login_failed', 'auth', v_user.id::text, 'Account is not active');
    RETURN;
  END IF;

  IF v_user.password_hash <> ev_password_hash(p_password, v_user.salt) THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_user.id, 'login_failed', 'auth', v_user.id::text, 'Invalid password');
    RETURN;
  END IF;

  UPDATE "EV_Users" u
  SET last_login_at = NOW(), updated_at = NOW()
  WHERE u.id = v_user.id;

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (v_user.id, 'login', 'auth', v_user.id::text, 'Successful login');

  RETURN QUERY
  SELECT
    v_user.id,
    v_user.email,
    v_user.full_name,
    v_user.role,
    v_user.department,
    v_user.status,
    v_user.phone,
    v_user.avatar_url,
    v_user.employee_id,
    NOW(),
    v_user.created_at;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_ev_login(TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION change_ev_user_password(
  p_user_id UUID,
  p_current_password TEXT,
  p_new_password TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_salt TEXT;
  v_hash TEXT;
BEGIN
  SELECT salt, password_hash INTO v_salt, v_hash
  FROM "EV_Users"
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_hash <> ev_password_hash(p_current_password, v_salt) THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (p_user_id, 'login_failed', 'auth', p_user_id::text, 'Password change — wrong current password');
    RETURN false;
  END IF;

  UPDATE "EV_Users"
  SET
    password_hash = ev_password_hash(p_new_password, v_salt),
    updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (p_user_id, 'update', 'auth', p_user_id::text, 'Password changed');

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION change_ev_user_password(UUID, TEXT, TEXT) TO anon, authenticated;

-- Login activity RPC (fixes PGRST202 if app calls record_ev_login_attempt)
CREATE OR REPLACE FUNCTION public.record_ev_login_attempt(
  p_email TEXT,
  p_success BOOLEAN,
  p_details TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_action TEXT;
BEGIN
  v_action := CASE WHEN p_success THEN 'login' ELSE 'login_failed' END;

  SELECT id INTO v_user_id
  FROM "EV_Users"
  WHERE lower(email) = lower(trim(p_email))
  LIMIT 1;

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_user_id,
    v_action,
    'auth',
    COALESCE(v_user_id::text, lower(trim(p_email))),
    COALESCE(p_details, CASE WHEN p_success THEN 'Successful login' ELSE 'Failed login attempt' END)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_ev_login_attempt(TEXT, BOOLEAN, TEXT) TO anon, authenticated;


-- =============================================================================
-- FILE: supabase/fix_login.sql
-- =============================================================================

-- FIX: Login fails with "Invalid credentials" even with correct password (dfccil123)
-- Root cause: verify_ev_login had ambiguous column "id" (RETURNS TABLE vs row field).
-- Run this entire file in Supabase SQL Editor.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.ev_password_hash(p_password TEXT, p_salt TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT encode(digest(p_password || p_salt, 'sha256'::text), 'hex');
$$;

GRANT EXECUTE ON FUNCTION public.ev_password_hash(TEXT, TEXT) TO anon, authenticated;

DROP FUNCTION IF EXISTS verify_ev_login(TEXT, TEXT);

CREATE OR REPLACE FUNCTION verify_ev_login(p_email TEXT, p_password TEXT)
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  role TEXT,
  department TEXT,
  status TEXT,
  phone TEXT,
  avatar_url TEXT,
  employee_id TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_user "EV_Users"%ROWTYPE;
BEGIN
  SELECT * INTO v_user
  FROM "EV_Users" u
  WHERE lower(u.email) = lower(trim(p_email));

  IF NOT FOUND THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (NULL, 'login_failed', 'auth', lower(trim(p_email)), 'Unknown email');
    RETURN;
  END IF;

  IF v_user.status <> 'active' THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_user.id, 'login_failed', 'auth', v_user.id::text, 'Account is not active');
    RETURN;
  END IF;

  IF v_user.password_hash <> ev_password_hash(p_password, v_user.salt) THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_user.id, 'login_failed', 'auth', v_user.id::text, 'Invalid password');
    RETURN;
  END IF;

  UPDATE "EV_Users" u
  SET last_login_at = NOW(), updated_at = NOW()
  WHERE u.id = v_user.id;

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (v_user.id, 'login', 'auth', v_user.id::text, 'Successful login');

  RETURN QUERY
  SELECT
    v_user.id,
    v_user.email,
    v_user.full_name,
    v_user.role,
    v_user.department,
    v_user.status,
    v_user.phone,
    v_user.avatar_url,
    v_user.employee_id,
    NOW(),
    v_user.created_at;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_ev_login(TEXT, TEXT) TO anon, authenticated;

-- Reset demo passwords (all users: dfccil123)
UPDATE "EV_Users"
SET
  password_hash = '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4',
  salt = 'ev_salt_2026',
  status = 'active'
WHERE email LIKE '%@dfccil.gov.in';


-- =============================================================================
-- FILE: supabase/fix_wallet_rpc_ambiguous.sql
-- =============================================================================

-- Hotfix: ambiguous column references in wallet RPCs (RETURNS TABLE output names vs table columns).
-- Run in Supabase SQL Editor if ev_get_wallet_summary returns 42702.

CREATE OR REPLACE FUNCTION ev_get_or_create_wallet_account(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  balance_amount NUMERIC,
  hold_amount NUMERIC,
  currency TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "EV_Users" u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  INSERT INTO "EV_WalletAccounts" (user_id)
  VALUES (p_user_id)
  ON CONFLICT ON CONSTRAINT ev_wallet_accounts_user_unique DO NOTHING;

  RETURN QUERY
  SELECT w.id, w.user_id, w.balance_amount, w.hold_amount, w.currency, w.status, w.created_at, w.updated_at
  FROM "EV_WalletAccounts" w
  WHERE w.user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION ev_get_wallet_summary(p_user_id UUID)
RETURNS TABLE (
  wallet_account_id UUID,
  balance_amount NUMERIC,
  hold_amount NUMERIC,
  usable_balance NUMERIC,
  currency TEXT,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  PERFORM ev_get_or_create_wallet_account(p_user_id);

  RETURN QUERY
  SELECT
    w.id,
    w.balance_amount,
    w.hold_amount,
    (w.balance_amount - w.hold_amount) AS usable_balance,
    w.currency,
    w.status
  FROM "EV_WalletAccounts" w
  WHERE w.user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION ev_create_topup_order(
  p_user_id UUID,
  p_amount NUMERIC,
  p_gateway_name TEXT DEFAULT NULL
)
RETURNS TABLE (
  payment_order_id UUID,
  amount NUMERIC,
  status TEXT,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_order_id UUID;
  v_gateway TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "EV_Users" u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  IF p_amount IS NULL OR p_amount < 100 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  PERFORM ev_get_or_create_wallet_account(p_user_id);

  v_gateway := COALESCE(NULLIF(trim(p_gateway_name), ''), 'dfccil_gateway_pending');

  INSERT INTO "EV_PaymentOrders" (
    user_id, amount, currency, gateway_name, status, wallet_credited, metadata
  )
  VALUES (
    p_user_id,
    round(p_amount::numeric, 2),
    'INR',
    v_gateway,
    'created',
    false,
    jsonb_build_object('source', 'mobile_topup')
  )
  RETURNING id INTO v_order_id;

  RETURN QUERY
  SELECT v_order_id, round(p_amount::numeric, 2), 'created'::text,
    'Top-up order created. Awaiting gateway confirmation.'::text;
END;
$$;

CREATE OR REPLACE FUNCTION ev_get_payment_order_status(
  p_user_id UUID,
  p_payment_order_id UUID
)
RETURNS TABLE (
  payment_order_id UUID,
  amount NUMERIC,
  currency TEXT,
  status TEXT,
  wallet_credited BOOLEAN,
  failure_reason TEXT,
  checkout_url TEXT,
  gateway_name TEXT,
  gateway_order_id TEXT,
  gateway_payment_id TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.amount,
    o.currency,
    o.status,
    o.wallet_credited,
    o.failure_reason,
    o.checkout_url,
    o.gateway_name,
    o.gateway_order_id,
    o.gateway_payment_id,
    o.created_at,
    o.updated_at
  FROM "EV_PaymentOrders" o
  WHERE o.id = p_payment_order_id
    AND o.user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION ev_get_wallet_ledger(
  p_user_id UUID,
  p_limit INT DEFAULT 50,
  p_filter TEXT DEFAULT 'all'
)
RETURNS TABLE (
  id UUID,
  wallet_account_id UUID,
  transaction_type TEXT,
  amount NUMERIC,
  balance_before NUMERIC,
  balance_after NUMERIC,
  reference_type TEXT,
  reference_id UUID,
  remarks TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT
    l.id,
    l.wallet_account_id,
    l.transaction_type,
    l.amount,
    l.balance_before,
    l.balance_after,
    l.reference_type,
    l.reference_id,
    l.remarks,
    l.created_at
  FROM "EV_WalletLedger" l
  WHERE l.user_id = p_user_id
    AND (
      p_filter = 'all'
      OR (p_filter = 'credit' AND l.transaction_type = 'credit')
      OR (p_filter = 'debit' AND l.transaction_type = 'debit')
      OR (p_filter = 'hold' AND l.transaction_type IN ('hold', 'release'))
    )
  ORDER BY l.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
END;
$$;


-- =============================================================================
-- FILE: supabase/fix_payment_order_status_gateway.sql
-- =============================================================================

-- Include Razorpay gateway IDs in payment-order status RPC (run in Supabase SQL Editor).

CREATE OR REPLACE FUNCTION ev_get_payment_order_status(
  p_user_id UUID,
  p_payment_order_id UUID
)
RETURNS TABLE (
  payment_order_id UUID,
  amount NUMERIC,
  currency TEXT,
  status TEXT,
  wallet_credited BOOLEAN,
  failure_reason TEXT,
  checkout_url TEXT,
  gateway_name TEXT,
  gateway_order_id TEXT,
  gateway_payment_id TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.amount,
    o.currency,
    o.status,
    o.wallet_credited,
    o.failure_reason,
    o.checkout_url,
    o.gateway_name,
    o.gateway_order_id,
    o.gateway_payment_id,
    o.created_at,
    o.updated_at
  FROM "EV_PaymentOrders" o
  WHERE o.id = p_payment_order_id
    AND o.user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION ev_get_payment_order_status(UUID, UUID) TO anon, authenticated;


-- =============================================================================
-- FILE: supabase/enable_admin_bypass.sql
-- =============================================================================

-- Enable lab admin bypass on ALL chargers (fixes mobile RemoteStart without RFID).
-- Run in Supabase SQL Editor, then retry mobile Start.

ALTER TABLE "EV_Chargers"
  ADD COLUMN IF NOT EXISTS allow_admin_bypass BOOLEAN NOT NULL DEFAULT true;

UPDATE "EV_Chargers"
SET allow_admin_bypass = true,
    updated_at = NOW();

-- Verify
SELECT charge_point_id, name, allow_admin_bypass
FROM "EV_Chargers"
ORDER BY name;


-- =============================================================================
-- FILE: supabase/remove_admin_bypass.sql
-- =============================================================================

-- Session attribution columns (safe to run).
-- Web admin uses ADMIN-BYPASS idTag at OCPP; session user_id comes from logged-in admin.

ALTER TABLE public."EV_ChargingSessions"
  ADD COLUMN IF NOT EXISTS started_by TEXT;

COMMENT ON COLUMN public."EV_ChargingSessions".started_by IS
  'mobile | rfid | admin — who initiated charging';

COMMENT ON COLUMN public."EV_ChargingSessions".authorization_method IS
  'Mobile | RFID | Remote (admin ADMIN-BYPASS) | legacy values';

-- Ensure ADMIN-BYPASS RFID exists and is active for web admin Authorize.
INSERT INTO public."EV_RFIDCards" (uid, status, total_sessions, created_at, updated_at)
SELECT 'ADMIN-BYPASS', 'active', 0, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM public."EV_RFIDCards" WHERE upper(uid) = 'ADMIN-BYPASS'
);

UPDATE public."EV_RFIDCards"
SET status = 'active',
    user_id = NULL,
    updated_at = NOW()
WHERE upper(uid) = 'ADMIN-BYPASS'
  AND (lower(status) = 'blocked' OR user_id IS NOT NULL);

-- Web admin start enabled by default on all chargers.
ALTER TABLE public."EV_Chargers"
  ADD COLUMN IF NOT EXISTS allow_admin_bypass BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public."EV_Chargers"
  ALTER COLUMN allow_admin_bypass SET DEFAULT true;

UPDATE public."EV_Chargers"
SET allow_admin_bypass = true,
    updated_at = NOW()
WHERE allow_admin_bypass IS DISTINCT FROM true;


-- =============================================================================
-- FILE: supabase/seed.sql
-- =============================================================================

-- EV CMS seed data (run after schema.sql + rls.sql + rfp_roles.sql in Supabase SQL Editor)
-- UUIDs must use hex digits only (0-9, a-f) — no letters like p, l, g in IDs.
-- Demo password for all users: dfccil123
-- Hash: SHA-256(password + salt) hex, salt = ev_salt_2026
--
-- RFP demo logins:
--   Mobile User (+ RFID): rajesh.kumar@dfccil.gov.in | suresh.nair@dfccil.gov.in
--   Web Super Admin:      anita.desai@dfccil.gov.in
--   Web Site Admin:       deepak.mehta@dfccil.gov.in
--   (DB role Operator/Viewer → app displays as User)

-- Optional reset (dev only):
-- TRUNCATE "EV_Payments", "EV_Receipts", "EV_MeterValues", "EV_ChargingSessions",
--   "EV_AuditLogs", "EV_RFIDCards", "EV_Tariffs", "EV_ChargerConnectors", "EV_Chargers",
--   "EV_UserSessions", "EV_Users", "EV_UserRoles" CASCADE;

INSERT INTO "EV_UserRoles" (code, name, description) VALUES
  ('SuperAdmin', 'Super Admin', 'RFP: full web admin access'),
  ('SiteAdmin', 'Site Admin', 'RFP: site-level web admin'),
  ('User', 'User', 'RFP: mobile charging app'),
  ('Operator', 'User (legacy)', 'Legacy DB value; maps to RFP User'),
  ('Viewer', 'User (legacy)', 'Legacy DB value; maps to RFP User')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

INSERT INTO "EV_Users" (id, email, password_hash, salt, full_name, role, status, department, last_login_at, created_at) VALUES
  ('a0000001-0000-4000-8000-000000000001', 'rajesh.kumar@dfccil.gov.in', '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4', 'ev_salt_2026', 'Rajesh Kumar', 'Operator', 'active', 'Operations', '2026-06-01 07:30:00+00', '2026-01-15'),
  ('a0000001-0000-4000-8000-000000000002', 'amit.sharma@dfccil.gov.in', '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4', 'ev_salt_2026', 'Amit Sharma', 'Operator', 'active', 'Operations', '2026-06-01 08:05:00+00', '2026-02-01'),
  ('a0000001-0000-4000-8000-000000000003', 'priya.singh@dfccil.gov.in', '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4', 'ev_salt_2026', 'Priya Singh', 'Operator', 'active', 'Logistics', '2026-06-01 07:45:00+00', '2026-01-20'),
  ('a0000001-0000-4000-8000-000000000004', 'sunil.verma@dfccil.gov.in', '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4', 'ev_salt_2026', 'Sunil Verma', 'Operator', 'active', 'Logistics', '2026-06-01 08:10:00+00', '2026-03-10'),
  ('a0000001-0000-4000-8000-000000000005', 'vikram.patel@dfccil.gov.in', '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4', 'ev_salt_2026', 'Vikram Patel', 'Operator', 'active', 'Operations', '2026-06-01 08:30:00+00', '2026-02-15'),
  ('a0000001-0000-4000-8000-000000000006', 'anita.desai@dfccil.gov.in', '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4', 'ev_salt_2026', 'Anita Desai', 'SuperAdmin', 'active', 'IT', '2026-06-01 08:00:00+00', '2025-12-01'),
  ('a0000001-0000-4000-8000-000000000007', 'manoj.tiwari@dfccil.gov.in', '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4', 'ev_salt_2026', 'Manoj Tiwari', 'Viewer', 'active', 'Management', '2026-05-31 16:20:00+00', '2026-04-05'),
  ('a0000001-0000-4000-8000-000000000008', 'kavita.reddy@dfccil.gov.in', '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4', 'ev_salt_2026', 'Kavita Reddy', 'Operator', 'inactive', 'Operations', '2026-05-16 14:00:00+00', '2026-03-20'),
  ('a0000001-0000-4000-8000-000000000009', 'deepak.mehta@dfccil.gov.in', '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4', 'ev_salt_2026', 'Deepak Mehta', 'SiteAdmin', 'active', 'Operations', '2026-06-01 09:00:00+00', '2026-02-01'),
  ('a0000001-0000-4000-8000-00000000000a', 'suresh.nair@dfccil.gov.in', '58d127a9573f925e3066ae3b9381d88c2be6656ee5f371c61be99d405d1a98c4', 'ev_salt_2026', 'Suresh Nair', 'Operator', 'active', 'Logistics', '2026-06-01 08:45:00+00', '2026-03-01')
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  salt = EXCLUDED.salt,
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  status = EXCLUDED.status,
  department = EXCLUDED.department,
  last_login_at = EXCLUDED.last_login_at;

INSERT INTO "EV_Chargers" (id, charge_point_id, name, manufacturer, model, serial_number, firmware_version, charger_type, max_power_kw, status, location, last_heartbeat_at) VALUES
  ('b0000001-0000-4000-8000-000000000001', 'MP-DC-001', 'MP Fast Charger Station 1', 'MyPower Experts', 'MP-30DC-DG', 'MP2024DC001', 'v2.4.1', 'DC Fast', 60, 'online', 'DFCCIL Yard, New Delhi', '2026-06-01 10:32:15+00'),
  ('b0000001-0000-4000-8000-000000000002', 'MP-DC-002', 'MP Fast Charger Station 2', 'MyPower Experts', 'MP-30DC-DG', 'MP2024DC002', 'v2.4.1', 'DC Fast', 60, 'online', 'DFCCIL Yard, New Delhi', '2026-06-01 10:31:48+00'),
  ('b0000001-0000-4000-8000-000000000003', 'MP-DC-003', 'MP Fast Charger Station 3', 'MyPower Experts', 'MP-30DC-DG', 'MP2024DC003', 'v2.4.1', 'DC Fast', 60, 'faulted', 'DFCCIL Warehouse, Mumbai', '2026-06-01 09:15:22+00'),
  ('b0000001-0000-4000-8000-000000000004', 'MP-DC-004', 'MP Fast Charger Station 4', 'MyPower Experts', 'MP-30DC-DG', 'MP2024DC004', 'v2.4.0', 'DC Fast', 60, 'online', 'DFCCIL Warehouse, Mumbai', '2026-06-01 10:32:00+00'),
  ('b0000001-0000-4000-8000-000000000005', 'MP-AC-001', 'MP Slow Charger Bay 1', 'MyPower Experts', 'MP-7.5AC-SG', 'MP2024AC001', 'v1.9.3', 'AC Slow', 7.5, 'online', 'DFCCIL Staff Parking, Delhi', '2026-06-01 10:31:55+00'),
  ('b0000001-0000-4000-8000-000000000006', 'MP-AC-002', 'MP Slow Charger Bay 2', 'MyPower Experts', 'MP-7.5AC-SG', 'MP2024AC002', 'v1.9.3', 'AC Slow', 7.5, 'online', 'DFCCIL Staff Parking, Delhi', '2026-06-01 10:30:10+00'),
  ('b0000001-0000-4000-8000-000000000007', 'MP-AC-003', 'MP Slow Charger Bay 3', 'MyPower Experts', 'MP-7.5AC-SG', 'MP2024AC003', 'v1.9.3', 'AC Slow', 7.5, 'offline', 'DFCCIL Staff Parking, Delhi', '2026-05-31 22:45:00+00'),
  ('b0000001-0000-4000-8000-000000000008', 'MP-AC-004', 'MP Slow Charger Bay 4', 'MyPower Experts', 'MP-7.5AC-SG', 'MP2024AC004', 'v1.9.3', 'AC Slow', 7.5, 'online', 'DFCCIL Depot, Chennai', '2026-06-01 10:29:40+00'),
  ('b0000001-0000-4000-8000-000000000009', 'MP-AC-005', 'MP Slow Charger Bay 5', 'MyPower Experts', 'MP-7.5AC-SG', 'MP2024AC005', 'v1.9.3', 'AC Slow', 7.5, 'online', 'DFCCIL Depot, Chennai', '2026-06-01 10:30:50+00'),
  ('b0000001-0000-4000-8000-000000000010', 'MP-AC-006', 'MP Slow Charger Bay 6', 'MyPower Experts', 'MP-7.5AC-SG', 'MP2024AC006', 'v1.9.3', 'AC Slow', 7.5, 'online', 'DFCCIL Depot, Chennai', '2026-06-01 10:31:20+00'),
  ('b0000001-0000-4000-8000-000000000011', 'TS-DC-001', 'TS Fast Charger Station 1', 'Tri Square', 'TS-30DC-DG', 'TS2024DC001', 'v3.1.0', 'DC Fast', 60, 'online', 'DFCCIL Yard, Kolkata', '2026-06-01 10:31:35+00'),
  ('b0000001-0000-4000-8000-000000000012', 'TS-AC-001', 'TS Slow Charger Bay 1', 'Tri Square', 'TS-7.4AC-SG', 'TS2024AC001', 'v2.0.5', 'AC Slow', 7.4, 'online', 'DFCCIL Depot, Kolkata', '2026-06-01 10:30:30+00')
ON CONFLICT (charge_point_id) DO UPDATE SET
  name = EXCLUDED.name, status = EXCLUDED.status, last_heartbeat_at = EXCLUDED.last_heartbeat_at;

INSERT INTO "EV_ChargerConnectors" (id, charger_id, connector_id, connector_type, max_power_kw, status) VALUES
  ('c0000001-0000-4000-8000-000000000001', 'b0000001-0000-4000-8000-000000000001', 1, 'CCS2', 30, 'Charging'),
  ('c0000001-0000-4000-8000-000000000002', 'b0000001-0000-4000-8000-000000000001', 2, 'CCS2', 30, 'Available'),
  ('c0000001-0000-4000-8000-000000000003', 'b0000001-0000-4000-8000-000000000002', 1, 'CCS2', 30, 'Available'),
  ('c0000001-0000-4000-8000-000000000004', 'b0000001-0000-4000-8000-000000000002', 2, 'CCS2', 30, 'Available'),
  ('c0000001-0000-4000-8000-000000000005', 'b0000001-0000-4000-8000-000000000003', 1, 'CCS2', 30, 'Faulted'),
  ('c0000001-0000-4000-8000-000000000006', 'b0000001-0000-4000-8000-000000000003', 2, 'CCS2', 30, 'Faulted'),
  ('c0000001-0000-4000-8000-000000000007', 'b0000001-0000-4000-8000-000000000004', 1, 'CCS2', 30, 'Charging'),
  ('c0000001-0000-4000-8000-000000000008', 'b0000001-0000-4000-8000-000000000004', 2, 'CCS2', 30, 'Available'),
  ('c0000001-0000-4000-8000-000000000009', 'b0000001-0000-4000-8000-000000000005', 1, 'Type2', 7.5, 'Charging'),
  ('c0000001-0000-4000-8000-000000000010', 'b0000001-0000-4000-8000-000000000006', 1, 'Type2', 7.5, 'Available'),
  ('c0000001-0000-4000-8000-000000000011', 'b0000001-0000-4000-8000-000000000007', 1, 'Type2', 7.5, 'Unavailable'),
  ('c0000001-0000-4000-8000-000000000012', 'b0000001-0000-4000-8000-000000000008', 1, 'Type2', 7.5, 'Available'),
  ('c0000001-0000-4000-8000-000000000013', 'b0000001-0000-4000-8000-000000000009', 1, 'Type2', 7.5, 'Charging'),
  ('c0000001-0000-4000-8000-000000000014', 'b0000001-0000-4000-8000-000000000010', 1, 'Type2', 7.5, 'Available'),
  ('c0000001-0000-4000-8000-000000000015', 'b0000001-0000-4000-8000-000000000011', 1, 'CCS2', 30, 'Available'),
  ('c0000001-0000-4000-8000-000000000016', 'b0000001-0000-4000-8000-000000000011', 2, 'CCS2', 30, 'Charging'),
  ('c0000001-0000-4000-8000-000000000017', 'b0000001-0000-4000-8000-000000000012', 1, 'Type2', 7.4, 'Available')
ON CONFLICT (charger_id, connector_id) DO UPDATE SET status = EXCLUDED.status;

INSERT INTO "EV_Tariffs" (id, name, rate_per_kwh, session_fee, gst_percent, applies_to, is_active, is_default, region, created_at) VALUES
  ('e0000001-0000-4000-8000-000000000010', 'Noida / UP — Standard (Temporary)', 7.70, 0, 18, 'All', true, true, 'Noida, Uttar Pradesh', '2026-06-01'),
  ('e0000001-0000-4000-8000-000000000001', 'DC Fast Charging - Standard', 15.00, 20.00, 18, 'DC Fast', true, false, NULL, '2026-01-01'),
  ('e0000001-0000-4000-8000-000000000002', 'AC Slow Charging - Standard', 8.00, 0, 18, 'AC Slow', true, false, NULL, '2026-01-01'),
  ('e0000001-0000-4000-8000-000000000003', 'DC Fast - Peak Hours', 18.00, 30.00, 18, 'DC Fast', false, false, NULL, '2026-03-15')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  rate_per_kwh = EXCLUDED.rate_per_kwh,
  session_fee = EXCLUDED.session_fee,
  gst_percent = EXCLUDED.gst_percent,
  applies_to = EXCLUDED.applies_to,
  is_active = EXCLUDED.is_active,
  is_default = EXCLUDED.is_default,
  region = EXCLUDED.region,
  updated_at = NOW();

INSERT INTO "EV_RFIDCards" (id, uid, user_id, status, last_used_at, total_sessions, created_at) VALUES
  ('d0000001-0000-4000-8000-000000000001', 'RFID-DFCCIL-001', 'a0000001-0000-4000-8000-000000000001', 'active', '2026-06-01 08:15:00+00', 47, '2026-01-15'),
  ('d0000001-0000-4000-8000-000000000002', 'RFID-DFCCIL-002', 'a0000001-0000-4000-8000-000000000002', 'active', '2026-06-01 09:30:00+00', 32, '2026-02-01'),
  ('d0000001-0000-4000-8000-000000000003', 'RFID-DFCCIL-003', 'a0000001-0000-4000-8000-000000000003', 'active', '2026-06-01 07:45:00+00', 28, '2026-01-20'),
  ('d0000001-0000-4000-8000-000000000004', 'RFID-DFCCIL-004', 'a0000001-0000-4000-8000-000000000004', 'active', '2026-06-01 09:00:00+00', 19, '2026-03-10'),
  ('d0000001-0000-4000-8000-000000000005', 'RFID-DFCCIL-005', 'a0000001-0000-4000-8000-000000000005', 'active', '2026-06-01 10:00:00+00', 35, '2026-02-15'),
  ('d0000001-0000-4000-8000-000000000006', 'RFID-DFCCIL-006', NULL, 'inactive', NULL, 0, '2026-05-01'),
  ('d0000001-0000-4000-8000-000000000007', 'RFID-DFCCIL-007', 'a0000001-0000-4000-8000-000000000008', 'blocked', '2026-05-15 14:30:00+00', 12, '2026-03-20'),
  ('d0000001-0000-4000-8000-000000000008', 'RFID-DFCCIL-008', NULL, 'active', NULL, 0, '2026-05-15'),
  ('d0000001-0000-4000-8000-000000000009', 'RFID-DFCCIL-009', 'a0000001-0000-4000-8000-000000000007', 'active', '2026-05-31 16:00:00+00', 8, '2026-04-05'),
  ('d0000001-0000-4000-8000-00000000000a', 'RFID-DFCCIL-010', 'a0000001-0000-4000-8000-00000000000a', 'active', NULL, 0, '2026-03-01')
ON CONFLICT (uid) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  status = EXCLUDED.status,
  last_used_at = EXCLUDED.last_used_at,
  total_sessions = EXCLUDED.total_sessions;

-- Active sessions
INSERT INTO "EV_ChargingSessions" (id, transaction_id, charger_id, connector_id, user_id, rfid_card_id, start_time, energy_kwh, current_power_kw, soc, status) VALUES
  ('f0000001-0000-4000-8000-000000000001', 1001, 'b0000001-0000-4000-8000-000000000001', 1, 'a0000001-0000-4000-8000-000000000001', 'd0000001-0000-4000-8000-000000000001', '2026-06-01 08:15:00+00', 38.5, 28.4, 78, 'active'),
  ('f0000001-0000-4000-8000-000000000002', 1002, 'b0000001-0000-4000-8000-000000000004', 1, 'a0000001-0000-4000-8000-000000000002', 'd0000001-0000-4000-8000-000000000002', '2026-06-01 09:30:00+00', 18.2, 26.1, 45, 'active'),
  ('f0000001-0000-4000-8000-000000000003', 1003, 'b0000001-0000-4000-8000-000000000005', 1, 'a0000001-0000-4000-8000-000000000003', 'd0000001-0000-4000-8000-000000000003', '2026-06-01 07:45:00+00', 16.8, 6.8, 92, 'active'),
  ('f0000001-0000-4000-8000-000000000004', 1004, 'b0000001-0000-4000-8000-000000000009', 1, 'a0000001-0000-4000-8000-000000000004', 'd0000001-0000-4000-8000-000000000004', '2026-06-01 09:00:00+00', 9.4, 6.5, 65, 'active'),
  ('f0000001-0000-4000-8000-000000000005', 1005, 'b0000001-0000-4000-8000-000000000011', 2, 'a0000001-0000-4000-8000-000000000005', 'd0000001-0000-4000-8000-000000000005', '2026-06-01 10:00:00+00', 14.6, 29.1, 55, 'active')
ON CONFLICT (id) DO NOTHING;

-- Completed sessions (history)
INSERT INTO "EV_ChargingSessions" (id, transaction_id, charger_id, connector_id, user_id, rfid_card_id, start_time, end_time, energy_kwh, start_meter, end_meter, amount, status, stop_reason) VALUES
  ('f0000002-0000-4000-8000-000000000001', 901, 'b0000001-0000-4000-8000-000000000001', 1, 'a0000001-0000-4000-8000-000000000001', 'd0000001-0000-4000-8000-000000000001', '2026-05-31 14:30:00+00', '2026-05-31 16:15:00+00', 42.3, 12450, 12873, 634.50, 'completed', 'EV Disconnected'),
  ('f0000002-0000-4000-8000-000000000002', 902, 'b0000001-0000-4000-8000-000000000002', 1, 'a0000001-0000-4000-8000-000000000002', 'd0000001-0000-4000-8000-000000000002', '2026-05-31 12:00:00+00', '2026-05-31 13:30:00+00', 38.7, 9800, 10187, 580.50, 'completed', 'EV Disconnected'),
  ('f0000002-0000-4000-8000-000000000003', 903, 'b0000001-0000-4000-8000-000000000005', 1, 'a0000001-0000-4000-8000-000000000003', 'd0000001-0000-4000-8000-000000000003', '2026-05-30 09:00:00+00', '2026-05-30 14:15:00+00', 35.8, 5670, 6028, 286.40, 'completed', 'Local'),
  ('f0000002-0000-4000-8000-000000000004', 904, 'b0000001-0000-4000-8000-000000000004', 1, 'a0000001-0000-4000-8000-000000000005', 'd0000001-0000-4000-8000-000000000005', '2026-05-30 16:00:00+00', '2026-05-30 17:20:00+00', 31.2, 3400, 3712, 468.00, 'completed', 'EV Disconnected')
ON CONFLICT (id) DO NOTHING;

INSERT INTO "EV_Payments" (id, session_id, user_id, amount, gst_amount, total_amount, status, gateway, gateway_txn_id, reconciliation_status, created_at) VALUES
  ('90000001-0000-4000-8000-000000000001', 'f0000002-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000001', 597.00, 91.00, 688.00, 'success', 'SBIePay', 'SBI-20260531-001', 'matched', '2026-05-31 16:30:00+00'),
  ('90000001-0000-4000-8000-000000000002', 'f0000002-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-000000000002', 456.00, 69.50, 525.50, 'success', 'SBIePay', 'SBI-20260531-002', 'matched', '2026-05-31 14:15:00+00'),
  ('90000001-0000-4000-8000-000000000003', 'f0000002-0000-4000-8000-000000000003', 'a0000001-0000-4000-8000-000000000003', 134.40, 20.50, 154.90, 'success', 'SBIePay', 'SBI-20260601-001', 'matched', '2026-06-01 10:32:00+00'),
  ('90000001-0000-4000-8000-000000000004', 'f0000001-0000-4000-8000-000000000004', 'a0000001-0000-4000-8000-000000000004', 0, 0, 0, 'pending', NULL, NULL, 'unmatched', '2026-06-01 10:32:00+00'),
  ('90000001-0000-4000-8000-000000000005', 'f0000002-0000-4000-8000-000000000004', 'a0000001-0000-4000-8000-000000000005', 219.00, 33.40, 252.40, 'success', 'SBIePay', 'SBI-20260530-005', 'matched', '2026-05-30 11:45:00+00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO "EV_AuditLogs" (id, user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES
  ('ab000001-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000006', 'User Created', 'User', 'a0000001-0000-4000-8000-000000000008', 'Created user Kavita Reddy with role Operator', '10.45.2.18', '2026-03-20 10:30:00+00'),
  ('ab000001-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-000000000006', 'RFID Bound', 'RFID', 'd0000001-0000-4000-8000-000000000007', 'Bound RFID-DFCCIL-007 to user Kavita Reddy', '10.45.2.18', '2026-03-20 10:32:00+00'),
  ('ab000001-0000-4000-8000-000000000003', 'a0000001-0000-4000-8000-000000000006', 'Tariff Created', 'Tariff', 'e0000001-0000-4000-8000-000000000003', 'Created DC Fast Peak Hours tariff at ₹18/kWh', '10.45.2.18', '2026-03-15 09:00:00+00'),
  ('ab000001-0000-4000-8000-000000000004', 'a0000001-0000-4000-8000-000000000001', 'Remote Start', 'Session', 'f0000001-0000-4000-8000-000000000002', 'Started charging on MP-DC-004 Gun 1', '10.45.2.22', '2026-05-29 15:00:00+00'),
  ('ab000001-0000-4000-8000-000000000005', 'a0000001-0000-4000-8000-000000000006', 'Login', 'Auth', 'a0000001-0000-4000-8000-000000000006', 'Successful login from 10.45.2.18', '10.45.2.18', '2026-06-01 08:00:00+00'),
  ('ab000001-0000-4000-8000-000000000006', 'a0000001-0000-4000-8000-000000000006', 'Charger Reset', 'Charger', 'b0000001-0000-4000-8000-000000000003', 'Sent Reset command to MP-DC-003 (faulted)', '10.45.2.18', '2026-06-01 09:10:00+00'),
  ('ab000001-0000-4000-8000-000000000007', 'a0000001-0000-4000-8000-000000000005', 'Login', 'Auth', 'a0000001-0000-4000-8000-000000000005', 'Successful login from 10.45.2.30', '10.45.2.30', '2026-06-01 08:30:00+00'),
  ('ab000001-0000-4000-8000-000000000008', 'a0000001-0000-4000-8000-000000000002', 'Login Failed', 'Auth', 'a0000001-0000-4000-8000-000000000002', 'Invalid password attempt from 10.45.3.12', '10.45.3.12', '2026-06-01 07:55:00+00'),
  ('ab000001-0000-4000-8000-000000000009', 'a0000001-0000-4000-8000-000000000001', 'Login', 'Auth', 'a0000001-0000-4000-8000-000000000001', 'Successful login from 10.45.2.22', '10.45.2.22', '2026-06-01 07:30:00+00'),
  ('ab000001-0000-4000-8000-000000000010', 'a0000001-0000-4000-8000-000000000003', 'Remote Start', 'Session', 'f0000001-0000-4000-8000-000000000003', 'Started charging on MP-AC-001 via RFID-DFCCIL-003', '10.45.2.25', '2026-06-01 07:45:00+00')
ON CONFLICT (id) DO NOTHING;
