-- DFCCIL SSO: match IdP UserId (employee code) to EV_Users. Roles stay in CMS.
-- Run once in the Supabase SQL Editor after profile_and_storage.sql.

ALTER TABLE "EV_Users"
  ADD COLUMN IF NOT EXISTS sso_sub TEXT;

COMMENT ON COLUMN "EV_Users".sso_sub IS 'Stable DFCCIL SSO subject (sub), stored after the first successful SSO login';

CREATE OR REPLACE FUNCTION resolve_ev_user_for_sso(p_employee_code TEXT, p_sso_sub TEXT DEFAULT NULL)
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
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_user "EV_Users"%ROWTYPE;
  v_code TEXT := trim(p_employee_code);
BEGIN
  IF v_code IS NULL OR v_code = '' THEN
    RETURN;
  END IF;

  SELECT * INTO v_user
  FROM "EV_Users" u
  WHERE trim(u.employee_id) = v_code;

  IF NOT FOUND THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (NULL, 'sso_login_denied', 'auth', v_code, 'User not registered in EV-CMS');
    RETURN;
  END IF;

  IF v_user.status <> 'active' THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_user.id, 'sso_login_denied', 'auth', v_user.id::text, 'Account is not active');
    RETURN;
  END IF;

  UPDATE "EV_Users" u
  SET
    last_login_at = NOW(),
    updated_at = NOW(),
    sso_sub = COALESCE(NULLIF(trim(p_sso_sub), ''), u.sso_sub)
  WHERE u.id = v_user.id;

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (v_user.id, 'sso_login', 'auth', v_user.id::text, 'Successful DFCCIL SSO login');

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

GRANT EXECUTE ON FUNCTION resolve_ev_user_for_sso(TEXT, TEXT) TO anon, authenticated;
