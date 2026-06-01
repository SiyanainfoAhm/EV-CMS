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
