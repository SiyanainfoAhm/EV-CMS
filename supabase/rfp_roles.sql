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
