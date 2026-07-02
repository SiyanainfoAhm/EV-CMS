-- Direct session payment via Razorpay (no wallet). Run in Supabase SQL Editor.
-- Replaces wallet-based session payment for the mobile app.

-- Recalculate pending payment from session energy × active tariff before checkout.
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
  SELECT s.id, s.user_id, s.energy_kwh, s.tariff_id
  INTO v_sess
  FROM "EV_ChargingSessions" s
  WHERE s.id = p_session_id
    AND s.user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND';
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
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.session_id,
    p.amount,
    p.gst_amount,
    p.total_amount,
    p.status,
    CASE
      WHEN p.status IN ('success', 'paid') THEN 0::numeric
      ELSE p.total_amount
    END,
    CASE
      WHEN p.gateway = 'razorpay' AND p.status = 'pending' THEN p.gateway_txn_id
      ELSE NULL::text
    END
  FROM "EV_Payments" p
  WHERE p.session_id = p_session_id
    AND p.user_id = p_user_id
  ORDER BY p.created_at DESC
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION ev_bind_session_razorpay_order(
  p_user_id UUID,
  p_payment_id UUID,
  p_gateway_order_id TEXT
)
RETURNS TABLE (
  payment_id UUID,
  session_id UUID,
  amount NUMERIC,
  status TEXT,
  gateway_order_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_payment RECORD;
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
    RAISE EXCEPTION 'PAYMENT_ALREADY_COMPLETED';
  END IF;

  UPDATE "EV_Payments"
  SET
    gateway = 'razorpay',
    gateway_txn_id = p_gateway_order_id,
    updated_at = NOW()
  WHERE id = p_payment_id;

  RETURN QUERY
  SELECT
    v_payment.id,
    v_payment.session_id,
    v_payment.amount,
    v_payment.status,
    p_gateway_order_id;
END;
$$;

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
    updated_at = NOW()
  WHERE id = p_payment_id;

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
    v_payment.amount,
    'success'::text,
    v_receipt_number,
    p_gateway_order_id,
    p_gateway_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION ev_get_session_payment(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_bind_session_razorpay_order(UUID, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_complete_session_razorpay_payment(UUID, UUID, TEXT, TEXT) TO service_role;
