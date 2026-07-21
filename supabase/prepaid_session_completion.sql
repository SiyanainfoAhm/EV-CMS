-- Prepaid session completion: do not ask for payment again after stop.
-- Run in Supabase SQL Editor after prepaid_billing.sql / SESSION_RAZORPAY_PAYMENT.sql.
-- Mobile-only product path; admin web RemoteStart is unchanged.

-- =============================================================================
-- Optional session payment metadata (safe IF NOT EXISTS)
-- =============================================================================

ALTER TABLE "EV_ChargingSessions"
  ADD COLUMN IF NOT EXISTS payment_mode TEXT,
  ADD COLUMN IF NOT EXISTS prepaid_type TEXT,
  ADD COLUMN IF NOT EXISTS payment_status TEXT,
  ADD COLUMN IF NOT EXISTS payment_id UUID,
  ADD COLUMN IF NOT EXISTS prepaid_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS prepaid_duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS amount_due NUMERIC(12, 2) DEFAULT 0;

COMMENT ON COLUMN "EV_ChargingSessions".payment_mode IS
  'prepaid | postpaid | pay_after_session — mobile completion banner uses this';
COMMENT ON COLUMN "EV_ChargingSessions".prepaid_type IS
  'amount | time when payment_mode=prepaid (mirrors prepaid_mode)';
COMMENT ON COLUMN "EV_ChargingSessions".payment_status IS
  'pending | paid | failed — prepaid starts as paid after Razorpay success';
COMMENT ON COLUMN "EV_ChargingSessions".amount_due IS
  'Post-session amount still owed; must stay 0 for prepaid sessions';

-- Backfill from existing prepaid fields
UPDATE "EV_ChargingSessions"
SET
  payment_mode = COALESCE(payment_mode, 'prepaid'),
  prepaid_type = COALESCE(prepaid_type, prepaid_mode),
  payment_status = COALESCE(payment_status, 'paid'),
  prepaid_amount = COALESCE(prepaid_amount, prepaid_total_inr),
  amount_due = 0
WHERE prepaid_mode IS NOT NULL
   OR COALESCE(prepaid_total_inr, 0) > 0;

-- =============================================================================
-- Sync bill: never reopen prepaid as pending / amount_due
-- =============================================================================

CREATE OR REPLACE FUNCTION ev_sync_session_payment_bill(
  p_user_id UUID,
  p_session_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_bill RECORD;
BEGIN
  SELECT
    s.id,
    s.user_id,
    s.energy_kwh,
    s.tariff_id,
    s.prepaid_total_inr,
    s.prepaid_mode,
    s.payment_mode,
    s.payment_status
  INTO v_sess
  FROM "EV_ChargingSessions" s
  WHERE s.id = p_session_id
    AND s.user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND';
  END IF;

  -- Prepaid: keep paid totals; never rewrite pending post-session bill.
  IF lower(COALESCE(v_sess.payment_mode, '')) = 'prepaid'
     OR COALESCE(v_sess.prepaid_mode, '') IN ('amount', 'time')
     OR COALESCE(v_sess.prepaid_total_inr, 0) > 0
     OR lower(COALESCE(v_sess.payment_status, '')) = 'paid'
  THEN
    UPDATE "EV_ChargingSessions"
    SET
      payment_mode = COALESCE(payment_mode, 'prepaid'),
      payment_status = COALESCE(NULLIF(payment_status, ''), 'paid'),
      amount_due = 0,
      updated_at = NOW()
    WHERE id = p_session_id;
    RETURN;
  END IF;

  SELECT *
  INTO v_bill
  FROM ev_calculate_session_bill(COALESCE(v_sess.energy_kwh, 0), v_sess.tariff_id)
  LIMIT 1;

  UPDATE "EV_ChargingSessions"
  SET amount = v_bill.amount, updated_at = NOW()
  WHERE id = p_session_id;

  UPDATE "EV_Payments"
  SET
    amount = v_bill.amount,
    gst_amount = v_bill.gst_amount,
    total_amount = v_bill.total_amount,
    updated_at = NOW()
  WHERE session_id = p_session_id
    AND user_id = p_user_id
    AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION ev_sync_session_payment_bill(UUID, UUID) TO anon, authenticated;

-- =============================================================================
-- Prefer paid prepaid payment; amount_due = 0 when paid / prepaid
-- =============================================================================

CREATE OR REPLACE FUNCTION ev_get_session_payment(
  p_user_id UUID,
  p_session_id UUID
)
RETURNS TABLE (
  payment_id UUID,
  session_id UUID,
  amount NUMERIC,
  gst_amount NUMERIC,
  total_amount NUMERIC,
  status TEXT,
  amount_due NUMERIC,
  gateway_order_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_sess RECORD;
  v_is_prepaid BOOLEAN := false;
BEGIN
  SELECT
    s.payment_mode,
    s.payment_status,
    s.prepaid_mode,
    s.prepaid_total_inr,
    s.amount_due
  INTO v_sess
  FROM "EV_ChargingSessions" s
  WHERE s.id = p_session_id
    AND s.user_id = p_user_id;

  IF FOUND THEN
    v_is_prepaid :=
      lower(COALESCE(v_sess.payment_mode, '')) = 'prepaid'
      OR COALESCE(v_sess.prepaid_mode, '') IN ('amount', 'time')
      OR COALESCE(v_sess.prepaid_total_inr, 0) > 0
      OR lower(COALESCE(v_sess.payment_status, '')) = 'paid';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.session_id,
    p.amount,
    p.gst_amount,
    p.total_amount,
    p.status,
    CASE
      WHEN v_is_prepaid THEN 0::numeric
      WHEN p.status IN ('success', 'paid') THEN 0::numeric
      WHEN v_sess.amount_due IS NOT NULL THEN COALESCE(v_sess.amount_due, 0)
      ELSE p.total_amount
    END,
    CASE
      WHEN p.gateway = 'razorpay' AND p.status = 'pending' THEN p.gateway_txn_id
      ELSE NULL::text
    END
  FROM "EV_Payments" p
  WHERE p.session_id = p_session_id
    AND p.user_id = p_user_id
  ORDER BY
    CASE WHEN p.status IN ('success', 'paid') THEN 0 ELSE 1 END,
    p.created_at DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION ev_get_session_payment(UUID, UUID) TO anon, authenticated;

-- =============================================================================
-- On Razorpay success: mark session prepaid/paid, amount_due = 0
-- =============================================================================

CREATE OR REPLACE FUNCTION ev_complete_session_razorpay_payment(
  p_user_id UUID,
  p_payment_id UUID,
  p_gateway_order_id TEXT,
  p_gateway_payment_id TEXT
)
RETURNS TABLE (
  payment_id UUID,
  session_id UUID,
  amount NUMERIC,
  status TEXT,
  receipt_number TEXT,
  gateway_order_id TEXT,
  gateway_payment_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_payment RECORD;
  v_receipt_number TEXT;
BEGIN
  SELECT p.*
  INTO v_payment
  FROM "EV_Payments" p
  WHERE p.id = p_payment_id
    AND p.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
  END IF;

  IF v_payment.status IN ('success', 'paid') THEN
    UPDATE "EV_ChargingSessions"
    SET
      payment_mode = COALESCE(payment_mode, 'prepaid'),
      payment_status = 'paid',
      payment_id = COALESCE(payment_id, v_payment.id),
      prepaid_payment_id = COALESCE(prepaid_payment_id, v_payment.id),
      amount_due = 0,
      updated_at = NOW()
    WHERE id = v_payment.session_id
      AND user_id = p_user_id;

    SELECT r.receipt_number
    INTO v_receipt_number
    FROM "EV_Receipts" r
    WHERE r.payment_id = v_payment.id
    LIMIT 1;

    RETURN QUERY
    SELECT
      v_payment.id,
      v_payment.session_id,
      v_payment.amount,
      v_payment.status,
      v_receipt_number,
      COALESCE(v_payment.gateway_txn_id, p_gateway_order_id),
      COALESCE(v_payment.gateway_txn_id, p_gateway_payment_id);
    RETURN;
  END IF;

  IF v_payment.gateway_txn_id IS NOT NULL
     AND v_payment.gateway_txn_id <> p_gateway_order_id THEN
    RAISE EXCEPTION 'GATEWAY_ORDER_MISMATCH';
  END IF;

  UPDATE "EV_Payments"
  SET
    status = 'success',
    gateway = 'razorpay',
    gateway_txn_id = p_gateway_payment_id,
    reconciliation_status = 'matched',
    payment_kind = COALESCE(payment_kind, 'prepaid'),
    updated_at = NOW()
  WHERE id = p_payment_id;

  UPDATE "EV_ChargingSessions"
  SET
    payment_mode = COALESCE(payment_mode, 'prepaid'),
    payment_status = 'paid',
    payment_id = v_payment.id,
    prepaid_payment_id = COALESCE(prepaid_payment_id, v_payment.id),
    amount_due = 0,
    settlement_status = COALESCE(settlement_status, 'active'),
    updated_at = NOW()
  WHERE id = v_payment.session_id
    AND user_id = p_user_id;

  SELECT r.receipt_number
  INTO v_receipt_number
  FROM "EV_Receipts" r
  WHERE r.payment_id = p_payment_id
  LIMIT 1;

  IF v_receipt_number IS NULL THEN
    v_receipt_number := 'RCP-' || UPPER(SUBSTRING(REPLACE(p_payment_id::text, '-', ''), 1, 8))
      || '-' || UPPER(TO_CHAR(NOW(), 'YYMMDDHH24MI'));
    INSERT INTO "EV_Receipts" (payment_id, receipt_number, pdf_url)
    VALUES (
      p_payment_id,
      v_receipt_number,
      'https://ev-cms.dfccil.gov.in/receipts/' || v_receipt_number || '.pdf'
    );
  END IF;

  RETURN QUERY
  SELECT
    p_payment_id,
    v_payment.session_id,
    v_payment.total_amount,
    'success'::text,
    v_receipt_number,
    p_gateway_order_id,
    p_gateway_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION ev_complete_session_razorpay_payment(UUID, UUID, TEXT, TEXT)
  TO anon, authenticated, service_role;

-- =============================================================================
-- Stop session: prepaid → no second pending payment / no Pay CTA notification
-- =============================================================================

CREATE OR REPLACE FUNCTION ev_sim_stop_session(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_bill RECORD;
  v_is_prepaid BOOLEAN := false;
  v_has_paid BOOLEAN := false;
BEGIN
  SELECT s.*
  INTO v_sess
  FROM "EV_ChargingSessions" s
  WHERE s.id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  v_is_prepaid :=
    lower(COALESCE(v_sess.payment_mode, '')) = 'prepaid'
    OR COALESCE(v_sess.prepaid_mode, '') IN ('amount', 'time')
    OR COALESCE(v_sess.prepaid_total_inr, 0) > 0
    OR lower(COALESCE(v_sess.payment_status, '')) = 'paid';

  SELECT EXISTS (
    SELECT 1
    FROM "EV_Payments" p
    WHERE p.session_id = p_session_id
      AND p.status IN ('success', 'paid')
  ) INTO v_has_paid;

  SELECT *
  INTO v_bill
  FROM ev_calculate_session_bill(COALESCE(v_sess.energy_kwh, 0), v_sess.tariff_id)
  LIMIT 1;

  IF v_is_prepaid OR v_has_paid THEN
    UPDATE "EV_ChargingSessions"
    SET
      status = 'completed',
      end_time = NOW(),
      amount = v_bill.amount,
      current_power_kw = 0,
      stop_reason = 'Local',
      payment_mode = COALESCE(payment_mode, 'prepaid'),
      payment_status = 'paid',
      amount_due = 0,
      settlement_status = COALESCE(settlement_status, 'settled'),
      settlement_amount = COALESCE(prepaid_total_inr, prepaid_amount, 0),
      updated_at = NOW()
    WHERE id = p_session_id;

    -- Keep existing paid prepaid payment; never insert a second pending bill.
    UPDATE "EV_Payments"
    SET
      payment_kind = COALESCE(payment_kind, 'prepaid'),
      updated_at = NOW()
    WHERE session_id = p_session_id
      AND status IN ('success', 'paid');

    PERFORM ev_sim_log_event(
      v_sess.charger_id, v_sess.connector_id, 'StopTransaction',
      jsonb_build_object('sessionId', p_session_id, 'prepaid', true, 'amount', COALESCE(v_sess.prepaid_total_inr, 0))
    );

    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_sess.user_id, 'Remote Stop', 'Session', p_session_id::text, 'Simulator StopTransaction (prepaid — no post-pay)');

    PERFORM ev_notify_user(
      v_sess.user_id,
      'Charging Completed',
      'Payment already received via prepaid plan.',
      'charging_stopped'
    );
  ELSE
    UPDATE "EV_ChargingSessions"
    SET
      status = 'completed',
      end_time = NOW(),
      amount = v_bill.amount,
      current_power_kw = 0,
      stop_reason = 'Local',
      payment_mode = COALESCE(payment_mode, 'postpaid'),
      payment_status = COALESCE(payment_status, 'pending'),
      amount_due = v_bill.total_amount,
      updated_at = NOW()
    WHERE id = p_session_id;

    INSERT INTO "EV_Payments" (session_id, user_id, amount, gst_amount, total_amount, status, gateway, reconciliation_status, payment_kind)
    VALUES (
      p_session_id, v_sess.user_id, v_bill.amount, v_bill.gst_amount, v_bill.total_amount,
      'pending', 'razorpay', 'unmatched', 'prepaid'
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
  END IF;

  UPDATE "EV_ChargerConnectors"
  SET status = 'Available', updated_at = NOW()
  WHERE charger_id = v_sess.charger_id AND connector_id = v_sess.connector_id;

  UPDATE "EV_Chargers"
  SET status = 'online', last_status_change_at = NOW(), last_heartbeat_at = NOW(), updated_at = NOW()
  WHERE id = v_sess.charger_id;

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

GRANT EXECUTE ON FUNCTION ev_sim_stop_session(UUID) TO anon, authenticated;
