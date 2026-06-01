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
