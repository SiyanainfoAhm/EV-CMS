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

GRANT EXECUTE ON FUNCTION create_ev_user(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_ev_user(UUID, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_ev_user_status(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_ev_user(UUID) TO anon, authenticated;
