-- Session payment from prepaid wallet (run in Supabase SQL Editor).
-- Mobile calls ev_get_session_payment / ev_pay_session_from_wallet after charging ends.

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
  wallet_balance NUMERIC,
  amount_due NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_wallet_balance NUMERIC := 0;
BEGIN
  PERFORM ev_get_or_create_wallet_account(p_user_id);

  SELECT w.balance_amount - w.hold_amount
  INTO v_wallet_balance
  FROM "EV_WalletAccounts" w
  WHERE w.user_id = p_user_id;

  RETURN QUERY
  SELECT
    p.id,
    p.session_id,
    p.amount,
    p.gst_amount,
    p.total_amount,
    p.status,
    COALESCE(v_wallet_balance, 0),
    CASE
      WHEN p.status IN ('success', 'paid') THEN 0::numeric
      ELSE p.total_amount
    END
  FROM "EV_Payments" p
  WHERE p.session_id = p_session_id
    AND p.user_id = p_user_id
  ORDER BY p.created_at DESC
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION ev_pay_session_from_wallet(
  p_user_id UUID,
  p_session_id UUID
)
RETURNS TABLE (
  payment_id UUID,
  status TEXT,
  total_amount NUMERIC,
  wallet_balance_after NUMERIC,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_payment RECORD;
  v_wallet RECORD;
  v_balance_after NUMERIC;
BEGIN
  SELECT p.*
  INTO v_payment
  FROM "EV_Payments" p
  WHERE p.session_id = p_session_id
    AND p.user_id = p_user_id
  ORDER BY p.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
  END IF;

  IF v_payment.status IN ('success', 'paid') THEN
    RETURN QUERY
    SELECT v_payment.id, v_payment.status, v_payment.total_amount, NULL::numeric,
      'Payment already completed.'::text;
    RETURN;
  END IF;

  PERFORM ev_get_or_create_wallet_account(p_user_id);

  SELECT w.*
  INTO v_wallet
  FROM "EV_WalletAccounts" w
  WHERE w.user_id = p_user_id
  FOR UPDATE;

  IF v_wallet.status <> 'active' THEN
    RAISE EXCEPTION 'WALLET_BLOCKED';
  END IF;

  IF (v_wallet.balance_amount - v_wallet.hold_amount) < v_payment.total_amount THEN
    RAISE EXCEPTION 'WALLET_LOW_BALANCE';
  END IF;

  v_balance_after := v_wallet.balance_amount - v_payment.total_amount;

  UPDATE "EV_WalletAccounts"
  SET balance_amount = v_balance_after, updated_at = NOW()
  WHERE id = v_wallet.id;

  INSERT INTO "EV_WalletLedger" (
    wallet_account_id, user_id, transaction_type, amount,
    balance_before, balance_after, reference_type, reference_id, remarks
  )
  VALUES (
    v_wallet.id, p_user_id, 'debit', v_payment.total_amount,
    v_wallet.balance_amount, v_balance_after, 'charging_session', p_session_id,
    'Charging session payment'
  );

  UPDATE "EV_Payments"
  SET status = 'success', gateway = COALESCE(gateway, 'wallet'), updated_at = NOW()
  WHERE id = v_payment.id;

  RETURN QUERY
  SELECT v_payment.id, 'success'::text, v_payment.total_amount, v_balance_after,
    'Payment completed from wallet.'::text;
END;
$$;

GRANT EXECUTE ON FUNCTION ev_get_session_payment(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_pay_session_from_wallet(UUID, UUID) TO anon, authenticated;
