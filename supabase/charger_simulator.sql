-- OCPP-ready charger simulator (run after schema.sql, rls.sql, policies_write.sql, notifications.sql)
-- Safe to re-run: policies use DROP IF EXISTS; functions use CREATE OR REPLACE.
-- Maps spec names to existing columns: charge_point_id=charger_code, name=charger_name, max_power_kw=power_rating

ALTER TABLE "EV_Chargers"
  ADD COLUMN IF NOT EXISTS is_simulated BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_status_change_at TIMESTAMPTZ;

ALTER TABLE "EV_ChargingSessions"
  ADD COLUMN IF NOT EXISTS authorization_method TEXT;

COMMENT ON COLUMN "EV_Chargers".is_simulated IS 'True when created/managed by OCPP simulator (no physical CP)';

-- Simulator write policies (demo anon key) — safe to re-run
DROP POLICY IF EXISTS "ev_anon_insert_sessions" ON "EV_ChargingSessions";
CREATE POLICY "ev_anon_insert_sessions" ON "EV_ChargingSessions"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_update_sessions" ON "EV_ChargingSessions";
CREATE POLICY "ev_anon_update_sessions" ON "EV_ChargingSessions"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_insert_meter" ON "EV_MeterValues";
CREATE POLICY "ev_anon_insert_meter" ON "EV_MeterValues"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_insert_events" ON "EV_ChargerEvents";
CREATE POLICY "ev_anon_insert_events" ON "EV_ChargerEvents"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_update_chargers" ON "EV_Chargers";
CREATE POLICY "ev_anon_update_chargers" ON "EV_Chargers"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_update_connectors" ON "EV_ChargerConnectors";
CREATE POLICY "ev_anon_update_connectors" ON "EV_ChargerConnectors"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_insert_chargers" ON "EV_Chargers";
CREATE POLICY "ev_anon_insert_chargers" ON "EV_Chargers"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_insert_connectors" ON "EV_ChargerConnectors";
CREATE POLICY "ev_anon_insert_connectors" ON "EV_ChargerConnectors"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_insert_payments" ON "EV_Payments";
CREATE POLICY "ev_anon_insert_payments" ON "EV_Payments"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_insert_audit" ON "EV_AuditLogs";
CREATE POLICY "ev_anon_insert_audit" ON "EV_AuditLogs"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE OR REPLACE FUNCTION ev_sim_log_event(
  p_charger_id UUID,
  p_connector_id INTEGER,
  p_event_type TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO "EV_ChargerEvents" (charger_id, connector_id, event_type, payload)
  VALUES (p_charger_id, p_connector_id, p_event_type, p_payload)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION ev_sim_create_demo_chargers()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i INTEGER;
  v_code TEXT;
  v_charger_id UUID;
  v_count INTEGER := 0;
BEGIN
  IF (SELECT COUNT(*) FROM "EV_Chargers" WHERE is_simulated = true) >= 12 THEN
    RETURN 0;
  END IF;

  FOR i IN 1..12 LOOP
    v_code := 'DFCCIL-DEL-' || lpad(i::text, 2, '0');
    IF EXISTS (SELECT 1 FROM "EV_Chargers" WHERE charge_point_id = v_code) THEN
      CONTINUE;
    END IF;

    INSERT INTO "EV_Chargers" (
      charge_point_id, name, manufacturer, model, charger_type, max_power_kw,
      status, location, last_heartbeat_at, last_status_change_at, is_simulated
    ) VALUES (
      v_code,
      'DFCCIL Sim Charger ' || lpad(i::text, 2, '0'),
      'EV Simulator',
      'SIM-60DC',
      'DC Fast',
      60,
      'online',
      'DFCCIL Yard, New Delhi (Sim)',
      NOW(),
      NOW(),
      true
    )
    RETURNING id INTO v_charger_id;

    INSERT INTO "EV_ChargerConnectors" (charger_id, connector_id, connector_type, max_power_kw, status)
    VALUES
      (v_charger_id, 1, 'CCS2', 30, 'Available'),
      (v_charger_id, 2, 'CCS2', 30, 'Available');

    PERFORM ev_sim_log_event(v_charger_id, NULL, 'BootNotification', jsonb_build_object('chargePointId', v_code));
    PERFORM ev_sim_log_event(v_charger_id, NULL, 'StatusNotification', jsonb_build_object('status', 'Available'));
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION ev_sim_heartbeat(p_charger_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_now TIMESTAMPTZ := NOW();
BEGIN
  UPDATE "EV_Chargers"
  SET last_heartbeat_at = v_now, updated_at = v_now,
      status = CASE WHEN status = 'offline' THEN 'online' ELSE status END
  WHERE id = p_charger_id;

  PERFORM ev_sim_log_event(p_charger_id, NULL, 'Heartbeat', jsonb_build_object('timestamp', v_now));
  RETURN v_now;
END;
$$;

CREATE OR REPLACE FUNCTION ev_sim_status_change(p_charger_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_db_status TEXT;
BEGIN
  v_db_status := CASE lower(trim(p_status))
    WHEN 'available' THEN 'online'
    WHEN 'charging' THEN 'online'
    WHEN 'preparing' THEN 'online'
    WHEN 'finishing' THEN 'online'
    WHEN 'faulted' THEN 'faulted'
    WHEN 'unavailable' THEN 'offline'
    WHEN 'offline' THEN 'offline'
    ELSE 'online'
  END;

  UPDATE "EV_Chargers"
  SET status = v_db_status, last_status_change_at = v_now, updated_at = v_now,
      last_heartbeat_at = CASE WHEN lower(trim(p_status)) = 'offline' THEN v_now - INTERVAL '20 minutes' ELSE NOW() END
  WHERE id = p_charger_id;

  UPDATE "EV_ChargerConnectors"
  SET status = p_status, updated_at = v_now
  WHERE charger_id = p_charger_id
    AND connector_id = 1;

  PERFORM ev_sim_log_event(p_charger_id, 1, 'StatusNotification', jsonb_build_object('status', p_status));
END;
$$;

CREATE OR REPLACE FUNCTION ev_sim_start_session(
  p_charger_id UUID,
  p_connector_id INTEGER,
  p_user_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
  v_txn INTEGER;
  v_tariff_id UUID;
  v_rfid_id UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM "EV_ChargingSessions"
    WHERE charger_id = p_charger_id AND connector_id = p_connector_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Connector already has an active session';
  END IF;

  SELECT ev_get_default_tariff_id() INTO v_tariff_id;
  IF v_tariff_id IS NULL THEN
    SELECT id INTO v_tariff_id FROM "EV_Tariffs" WHERE is_active = true ORDER BY created_at LIMIT 1;
  END IF;
  SELECT id INTO v_rfid_id FROM "EV_RFIDCards" WHERE user_id = p_user_id AND status = 'active' LIMIT 1;

  v_txn := (EXTRACT(EPOCH FROM NOW())::INTEGER % 2000000000);

  INSERT INTO "EV_ChargingSessions" (
    transaction_id, charger_id, connector_id, user_id, rfid_card_id, tariff_id,
    start_time, energy_kwh, current_power_kw, status, authorization_method
  ) VALUES (
    v_txn, p_charger_id, p_connector_id, p_user_id, v_rfid_id, v_tariff_id,
    NOW(), 0, 0, 'active', 'RFID'
  )
  RETURNING id INTO v_session_id;

  UPDATE "EV_ChargerConnectors"
  SET status = 'Charging', updated_at = NOW()
  WHERE charger_id = p_charger_id AND connector_id = p_connector_id;

  UPDATE "EV_Chargers"
  SET status = 'online', last_status_change_at = NOW(), last_heartbeat_at = NOW(), updated_at = NOW()
  WHERE id = p_charger_id;

  PERFORM ev_sim_log_event(p_charger_id, p_connector_id, 'Authorize', jsonb_build_object('userId', p_user_id));
  PERFORM ev_sim_log_event(p_charger_id, p_connector_id, 'StartTransaction', jsonb_build_object('sessionId', v_session_id));

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (p_user_id, 'Remote Start', 'Session', v_session_id::text, 'Simulator StartTransaction');

  PERFORM ev_notify_user(p_user_id, 'Charging started', 'Your session has begun on connector ' || p_connector_id::text, 'charging_started');

  UPDATE "EV_Notifications" n
  SET reference_type = 'charging_session', reference_id = v_session_id
  WHERE n.id = (
    SELECT id FROM "EV_Notifications"
    WHERE user_id = p_user_id AND type = 'charging_started'
    ORDER BY created_at DESC
    LIMIT 1
  );

  RETURN v_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION ev_sim_meter_value(p_session_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_delta NUMERIC;
  v_energy NUMERIC;
  v_power NUMERIC;
BEGIN
  SELECT * INTO v_sess FROM "EV_ChargingSessions" WHERE id = p_session_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active session';
  END IF;

  v_delta := (ARRAY[0.2, 0.4, 0.5, 0.8])[1 + floor(random() * 4)::int];
  v_energy := COALESCE(v_sess.energy_kwh, 0) + v_delta;
  v_power := 15 + floor(random() * 20)::int;

  INSERT INTO "EV_MeterValues" (session_id, charger_id, connector_id, sampled_at, energy_kwh, power_kw, soc)
  VALUES (p_session_id, v_sess.charger_id, v_sess.connector_id, NOW(), v_energy, v_power, LEAST(99, 20 + floor(v_energy)));

  UPDATE "EV_ChargingSessions"
  SET energy_kwh = v_energy, current_power_kw = v_power, updated_at = NOW()
  WHERE id = p_session_id;

  PERFORM ev_sim_log_event(v_sess.charger_id, v_sess.connector_id, 'MeterValues', jsonb_build_object('energyKwh', v_energy, 'powerKw', v_power));

  RETURN v_energy;
END;
$$;

CREATE OR REPLACE FUNCTION ev_sim_stop_session(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_bill RECORD;
BEGIN
  SELECT s.*
  INTO v_sess
  FROM "EV_ChargingSessions" s
  WHERE s.id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  SELECT *
  INTO v_bill
  FROM ev_calculate_session_bill(COALESCE(v_sess.energy_kwh, 0), v_sess.tariff_id)
  LIMIT 1;

  UPDATE "EV_ChargingSessions"
  SET status = 'completed', end_time = NOW(), amount = v_bill.amount,
      current_power_kw = 0, stop_reason = 'Local', updated_at = NOW()
  WHERE id = p_session_id;

  UPDATE "EV_ChargerConnectors"
  SET status = 'Available', updated_at = NOW()
  WHERE charger_id = v_sess.charger_id AND connector_id = v_sess.connector_id;

  UPDATE "EV_Chargers"
  SET status = 'online', last_status_change_at = NOW(), last_heartbeat_at = NOW(), updated_at = NOW()
  WHERE id = v_sess.charger_id;

  INSERT INTO "EV_Payments" (session_id, user_id, amount, gst_amount, total_amount, status, gateway, reconciliation_status)
  VALUES (
    p_session_id, v_sess.user_id, v_bill.amount, v_bill.gst_amount, v_bill.total_amount,
    'pending', 'razorpay', 'unmatched'
  );

  PERFORM ev_sim_log_event(
    v_sess.charger_id, v_sess.connector_id, 'StopTransaction',
    jsonb_build_object('sessionId', p_session_id, 'amount', v_bill.total_amount)
  );

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (v_sess.user_id, 'Remote Stop', 'Session', p_session_id::text, 'Simulator StopTransaction');

  PERFORM ev_notify_user(
    v_sess.user_id,
    'Charging completed',
    'Session finished. Pay ₹' || ROUND(v_bill.total_amount, 2)::text || ' to complete your session.',
    'charging_stopped'
  );

  UPDATE "EV_Notifications" n
  SET reference_type = 'charging_session', reference_id = p_session_id
  WHERE n.id = (
    SELECT id FROM "EV_Notifications"
    WHERE user_id = v_sess.user_id AND type = 'charging_stopped'
    ORDER BY created_at DESC
    LIMIT 1
  );
END;
$$;

CREATE OR REPLACE FUNCTION ev_sim_heartbeat_all()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD; n INTEGER := 0;
BEGIN
  FOR r IN SELECT id FROM "EV_Chargers" WHERE is_simulated = true LOOP
    PERFORM ev_sim_heartbeat(r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION ev_sim_meter_all_active()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD; n INTEGER := 0;
BEGIN
  FOR r IN SELECT id FROM "EV_ChargingSessions" WHERE status = 'active' LOOP
    PERFORM ev_sim_meter_value(r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION ev_sim_create_demo_chargers() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_sim_heartbeat(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_sim_status_change(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_sim_start_session(UUID, INTEGER, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_sim_meter_value(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_sim_stop_session(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_sim_heartbeat_all() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_sim_meter_all_active() TO anon, authenticated;

-- Enable Realtime (Supabase Dashboard → Database → Replication, or run if publication exists):
-- ALTER PUBLICATION supabase_realtime ADD TABLE "EV_Chargers";
-- ALTER PUBLICATION supabase_realtime ADD TABLE "EV_ChargingSessions";
-- ALTER PUBLICATION supabase_realtime ADD TABLE "EV_MeterValues";
-- ALTER PUBLICATION supabase_realtime ADD TABLE "EV_ChargerEvents";
-- ALTER PUBLICATION supabase_realtime ADD TABLE "EV_Notifications";
