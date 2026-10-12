-- UAT account set requested for the DFCCIL SSO integration.
-- This migration intentionally removes all other EV_Users and their user-owned data.

BEGIN;

-- Make this migration safe to run independently if the role-mapping migration
-- has not yet been applied.
ALTER TABLE "EV_Users"
  ADD COLUMN IF NOT EXISTS sso_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_users_sso_sub
  ON "EV_Users" (lower(trim(sso_sub)))
  WHERE sso_sub IS NOT NULL AND trim(sso_sub) <> '';

ALTER TABLE "EV_Users" DROP CONSTRAINT IF EXISTS ev_users_role_check;
UPDATE "EV_Users" SET role = 'SuperAdmin' WHERE role = 'SiteAdmin';
UPDATE "EV_Users" SET role = 'User' WHERE role <> 'SuperAdmin';
ALTER TABLE "EV_Users"
  ADD CONSTRAINT ev_users_role_check
  CHECK (role IN ('SuperAdmin', 'User'));
ALTER TABLE "EV_Users" ALTER COLUMN role SET DEFAULT 'User';

-- Remove dependent records that do not cascade from EV_Users.
DELETE FROM "EV_Payments"
WHERE user_id IN (SELECT id FROM "EV_Users" WHERE employee_id IS NULL OR employee_id NOT IN ('102199', '900025', '900034'));

DELETE FROM "EV_ChargingSessions"
WHERE user_id IN (SELECT id FROM "EV_Users" WHERE employee_id IS NULL OR employee_id NOT IN ('102199', '900025', '900034'));

DELETE FROM "EV_SupportTickets"
WHERE user_id IN (SELECT id FROM "EV_Users" WHERE employee_id IS NULL OR employee_id NOT IN ('102199', '900025', '900034'))
   OR assigned_to IN (SELECT id FROM "EV_Users" WHERE employee_id IS NULL OR employee_id NOT IN ('102199', '900025', '900034'));

DELETE FROM "EV_AuditLogs"
WHERE user_id IN (SELECT id FROM "EV_Users" WHERE employee_id IS NULL OR employee_id NOT IN ('102199', '900025', '900034'));

DELETE FROM "EV_RFIDCards"
WHERE user_id IN (SELECT id FROM "EV_Users" WHERE employee_id IS NULL OR employee_id NOT IN ('102199', '900025', '900034'));

DELETE FROM "EV_Users"
WHERE employee_id IS NULL OR employee_id NOT IN ('102199', '900025', '900034');

-- Create missing UAT users. Passwords are retained only for legacy/custom-auth compatibility;
-- SSO is the required web login mechanism.
INSERT INTO "EV_Users" (
  email, password_hash, salt, full_name, role, status, department, employee_id, sso_sub
)
SELECT
  '102199@dfccil.gov.in', ev_password_hash('Dfc$%^&*9', 'uat_sso_2026'), 'uat_sso_2026',
  'DFCCIL UAT Admin 102199', 'SuperAdmin', 'active', 'UAT', '102199',
  '49b29e77-5a32-4816-a842-882a92e57e55'
WHERE NOT EXISTS (SELECT 1 FROM "EV_Users" WHERE employee_id = '102199');

INSERT INTO "EV_Users" (
  email, password_hash, salt, full_name, role, status, department, employee_id, sso_sub
)
SELECT
  '900025@dfccil.gov.in', ev_password_hash('Dfcc$%^&*9', 'uat_sso_2026'), 'uat_sso_2026',
  'DFCCIL UAT Admin 900025', 'SuperAdmin', 'active', 'UAT', '900025',
  'a36f76cb-cef6-4b7b-9053-d5a54ab11dfd'
WHERE NOT EXISTS (SELECT 1 FROM "EV_Users" WHERE employee_id = '900025');

INSERT INTO "EV_Users" (
  email, password_hash, salt, full_name, role, status, department, employee_id, sso_sub
)
SELECT
  '900034@dfccil.gov.in', ev_password_hash('Dfcc@321', 'uat_sso_2026'), 'uat_sso_2026',
  'DFCCIL UAT User 900034', 'User', 'active', 'UAT', '900034',
  'cdab677d-fa11-480b-baf7-6806ade66186'
WHERE NOT EXISTS (SELECT 1 FROM "EV_Users" WHERE employee_id = '900034');

UPDATE "EV_Users"
SET role = CASE employee_id
  WHEN '102199' THEN 'SuperAdmin'
  WHEN '900025' THEN 'SuperAdmin'
  ELSE 'User'
END,
status = 'active', sso_sub = CASE employee_id
  WHEN '102199' THEN '49b29e77-5a32-4816-a842-882a92e57e55'
  WHEN '900025' THEN 'a36f76cb-cef6-4b7b-9053-d5a54ab11dfd'
  WHEN '900034' THEN 'cdab677d-fa11-480b-baf7-6806ade66186'
END,
updated_at = NOW()
WHERE employee_id IN ('102199', '900025', '900034');

-- Roles are managed only on EV_Users. Remove the former duplicate role table.
DROP TABLE IF EXISTS "EV_SSOAdminSubjects";

-- Rebuild the resolver so an authenticated, previously unknown SSO user is provisioned as a regular user.
DROP FUNCTION IF EXISTS resolve_ev_user_for_sso(TEXT, TEXT);

CREATE OR REPLACE FUNCTION resolve_ev_user_for_sso(
  p_sso_sub TEXT,
  p_employee_code TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID, email TEXT, full_name TEXT, role TEXT, department TEXT, status TEXT,
  phone TEXT, avatar_url TEXT, employee_id TEXT, last_login_at TIMESTAMPTZ, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_user "EV_Users"%ROWTYPE;
  v_sub TEXT := lower(trim(COALESCE(p_sso_sub, '')));
  v_code TEXT := trim(COALESCE(p_employee_code, ''));
  v_email TEXT;
BEGIN
  IF v_sub = '' THEN RETURN; END IF;

  SELECT * INTO v_user FROM "EV_Users" u WHERE lower(trim(u.sso_sub)) = v_sub;

  IF NOT FOUND AND v_code <> '' THEN
    SELECT * INTO v_user FROM "EV_Users" u WHERE trim(u.employee_id) = v_code;
    IF FOUND THEN
      UPDATE "EV_Users" SET sso_sub = v_sub, updated_at = NOW() WHERE id = v_user.id;
    END IF;
  END IF;

  IF NOT FOUND THEN
    v_email := CASE WHEN v_code <> '' THEN v_code || '@dfccil.gov.in'
      ELSE 'sso_' || replace(v_sub, '-', '') || '@dfccil.local' END;
    INSERT INTO "EV_Users" (
      email, password_hash, salt, full_name, role, status, employee_id, sso_sub
    ) VALUES (
      v_email, ev_password_hash(gen_random_uuid()::text, 'sso_managed'), 'sso_managed',
      CASE WHEN v_code <> '' THEN 'DFCCIL SSO User ' || v_code ELSE 'DFCCIL SSO User' END,
      'User', 'active', NULLIF(v_code, ''), v_sub
    )
    RETURNING * INTO v_user;

    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_user.id, 'sso_user_provisioned', 'auth', v_user.id::text,
      'New authenticated SSO user provisioned as regular user');
  END IF;

  -- Normalize any legacy role on an existing SSO-linked record before returning it.
  IF v_user.role <> 'SuperAdmin' THEN
    UPDATE "EV_Users" SET role = 'User', updated_at = NOW() WHERE id = v_user.id;
    v_user.role := 'User';
  END IF;

  IF v_user.status <> 'active' THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_user.id, 'sso_login_denied', 'auth', v_user.id::text, 'Account is not active');
    RETURN;
  END IF;

  UPDATE "EV_Users" SET last_login_at = NOW(), updated_at = NOW() WHERE id = v_user.id;
  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (v_user.id, 'sso_login', 'auth', v_user.id::text, 'Successful DFCCIL SSO login');

  RETURN QUERY SELECT v_user.id, v_user.email, v_user.full_name,
    v_user.role,
    v_user.department, v_user.status, v_user.phone, v_user.avatar_url,
    v_user.employee_id, NOW(), v_user.created_at;
END;
$$;

REVOKE ALL ON FUNCTION resolve_ev_user_for_sso(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_ev_user_for_sso(TEXT, TEXT) TO anon, authenticated;

COMMIT;
