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
CREATE POLICY "ev_anon_select_roles" ON "EV_UserRoles" FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "ev_anon_select_chargers" ON "EV_Chargers" FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "ev_anon_select_connectors" ON "EV_ChargerConnectors" FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "ev_anon_select_events" ON "EV_ChargerEvents" FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "ev_anon_select_rfid" ON "EV_RFIDCards" FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "ev_anon_select_tariffs" ON "EV_Tariffs" FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "ev_anon_select_sessions" ON "EV_ChargingSessions" FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "ev_anon_select_meter" ON "EV_MeterValues" FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "ev_anon_select_payments" ON "EV_Payments" FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "ev_anon_select_receipts" ON "EV_Receipts" FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "ev_anon_select_audit" ON "EV_AuditLogs" FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "ev_anon_select_tickets" ON "EV_SupportTickets" FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "ev_anon_select_notifications" ON "EV_Notifications" FOR SELECT TO anon, authenticated USING (true);

-- Users: no direct anon read (password_hash). Use verify_ev_login RPC.
CREATE POLICY "ev_deny_anon_users" ON "EV_Users" FOR SELECT TO anon USING (false);
CREATE POLICY "ev_auth_select_users" ON "EV_Users" FOR SELECT TO authenticated USING (true);

CREATE POLICY "ev_deny_anon_sessions_token" ON "EV_UserSessions" FOR SELECT TO anon USING (false);

-- Custom login (email + password) — not Supabase Auth
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
