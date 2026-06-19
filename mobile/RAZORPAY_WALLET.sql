-- Complete wallet top-up after Razorpay verification (run in Supabase SQL Editor).

CREATE OR REPLACE FUNCTION ev_complete_wallet_topup(
  p_user_id UUID,
  p_payment_order_id UUID,
  p_gateway_order_id TEXT,
  p_gateway_payment_id TEXT
)
RETURNS TABLE (
  payment_order_id UUID,
  amount NUMERIC,
  currency TEXT,
  status TEXT,
  wallet_credited BOOLEAN,
  failure_reason TEXT,
  gateway_name TEXT,
  gateway_order_id TEXT,
  gateway_payment_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_order RECORD;
  v_wallet RECORD;
  v_balance_after NUMERIC;
BEGIN
  SELECT *
  INTO v_order
  FROM "EV_PaymentOrders" o
  WHERE o.id = p_payment_order_id
    AND o.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND';
  END IF;

  IF v_order.wallet_credited OR v_order.status = 'paid' THEN
    RETURN QUERY
    SELECT
      v_order.id,
      v_order.amount,
      v_order.currency,
      v_order.status,
      v_order.wallet_credited,
      v_order.failure_reason,
      v_order.gateway_name,
      v_order.gateway_order_id,
      NULL::text;
    RETURN;
  END IF;

  PERFORM ev_get_or_create_wallet_account(p_user_id);

  SELECT w.*
  INTO v_wallet
  FROM "EV_WalletAccounts" w
  WHERE w.user_id = p_user_id
  FOR UPDATE;

  v_balance_after := v_wallet.balance_amount + v_order.amount;

  UPDATE "EV_WalletAccounts"
  SET balance_amount = v_balance_after, updated_at = NOW()
  WHERE id = v_wallet.id;

  INSERT INTO "EV_WalletLedger" (
    wallet_account_id, user_id, transaction_type, amount,
    balance_before, balance_after, reference_type, reference_id, remarks
  )
  VALUES (
    v_wallet.id, p_user_id, 'credit', v_order.amount,
    v_wallet.balance_amount, v_balance_after, 'payment_order', p_payment_order_id,
    'Wallet top-up via Razorpay'
  );

  UPDATE "EV_PaymentOrders"
  SET
    status = 'paid',
    wallet_credited = true,
    gateway_name = COALESCE(gateway_name, 'razorpay'),
    gateway_order_id = COALESCE(p_gateway_order_id, gateway_order_id),
    gateway_payment_id = p_gateway_payment_id,
    updated_at = NOW()
  WHERE id = p_payment_order_id;

  RETURN QUERY
  SELECT
    p_payment_order_id,
    v_order.amount,
    v_order.currency,
    'paid'::text,
    true,
    NULL::text,
    COALESCE(v_order.gateway_name, 'razorpay'),
    p_gateway_order_id,
    p_gateway_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION ev_complete_wallet_topup(UUID, UUID, TEXT, TEXT) TO service_role;
