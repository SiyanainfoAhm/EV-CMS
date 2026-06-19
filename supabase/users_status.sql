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
