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
