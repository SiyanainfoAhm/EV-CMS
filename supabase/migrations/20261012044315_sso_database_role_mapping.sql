-- Database-authoritative DFCCIL SSO identity and role mapping.
-- Apply after profile_and_storage.sql.

ALTER TABLE "EV_Users"
  ADD COLUMN IF NOT EXISTS sso_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_users_sso_sub
  ON "EV_Users" (lower(trim(sso_sub)))
  WHERE sso_sub IS NOT NULL AND trim(sso_sub) <> '';

COMMENT ON COLUMN "EV_Users".sso_sub IS
  'Stable DFCCIL OIDC subject (sub) linked to this EV-CMS user';

DROP FUNCTION IF EXISTS resolve_ev_user_for_sso(TEXT, TEXT);

CREATE OR REPLACE FUNCTION resolve_ev_user_for_sso(
  p_sso_sub TEXT,
  p_employee_code TEXT DEFAULT NULL
)
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
  v_sub TEXT := lower(trim(COALESCE(p_sso_sub, '')));
  v_employee_code TEXT := trim(COALESCE(p_employee_code, ''));
BEGIN
  IF v_sub = '' THEN
    RETURN;
  END IF;

  SELECT * INTO v_user
  FROM "EV_Users" u
  WHERE lower(trim(u.sso_sub)) = v_sub;

  IF NOT FOUND AND v_employee_code <> '' THEN
    SELECT * INTO v_user
    FROM "EV_Users" u
    WHERE trim(u.employee_id) = v_employee_code;

    IF FOUND THEN
      UPDATE "EV_Users" u
      SET sso_sub = v_sub, updated_at = NOW()
      WHERE u.id = v_user.id;
    END IF;
  END IF;

  IF NOT FOUND THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (NULL, 'sso_login_denied', 'auth', v_sub, 'User not registered in EV-CMS');
    RETURN;
  END IF;

  IF v_user.status <> 'active' THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_user.id, 'sso_login_denied', 'auth', v_user.id::text, 'Account is not active');
    RETURN;
  END IF;

  UPDATE "EV_Users" u
  SET last_login_at = NOW(), updated_at = NOW()
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

REVOKE ALL ON FUNCTION resolve_ev_user_for_sso(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_ev_user_for_sso(TEXT, TEXT) TO anon, authenticated;
