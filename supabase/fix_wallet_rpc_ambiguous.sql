-- Hotfix: ambiguous column references in wallet RPCs (RETURNS TABLE output names vs table columns).
-- Run in Supabase SQL Editor if ev_get_wallet_summary returns 42702.

CREATE OR REPLACE FUNCTION ev_get_or_create_wallet_account(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  balance_amount NUMERIC,
  hold_amount NUMERIC,
  currency TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "EV_Users" u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  INSERT INTO "EV_WalletAccounts" (user_id)
  VALUES (p_user_id)
  ON CONFLICT ON CONSTRAINT ev_wallet_accounts_user_unique DO NOTHING;

  RETURN QUERY
  SELECT w.id, w.user_id, w.balance_amount, w.hold_amount, w.currency, w.status, w.created_at, w.updated_at
  FROM "EV_WalletAccounts" w
  WHERE w.user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION ev_get_wallet_summary(p_user_id UUID)
RETURNS TABLE (
  wallet_account_id UUID,
  balance_amount NUMERIC,
  hold_amount NUMERIC,
  usable_balance NUMERIC,
  currency TEXT,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  PERFORM ev_get_or_create_wallet_account(p_user_id);

  RETURN QUERY
  SELECT
    w.id,
    w.balance_amount,
    w.hold_amount,
    (w.balance_amount - w.hold_amount) AS usable_balance,
    w.currency,
    w.status
  FROM "EV_WalletAccounts" w
  WHERE w.user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION ev_create_topup_order(
  p_user_id UUID,
  p_amount NUMERIC,
  p_gateway_name TEXT DEFAULT NULL
)
RETURNS TABLE (
  payment_order_id UUID,
  amount NUMERIC,
  status TEXT,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_order_id UUID;
  v_gateway TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "EV_Users" u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  IF p_amount IS NULL OR p_amount < 100 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  PERFORM ev_get_or_create_wallet_account(p_user_id);

  v_gateway := COALESCE(NULLIF(trim(p_gateway_name), ''), 'dfccil_gateway_pending');

  INSERT INTO "EV_PaymentOrders" (
    user_id, amount, currency, gateway_name, status, wallet_credited, metadata
  )
  VALUES (
    p_user_id,
    round(p_amount::numeric, 2),
    'INR',
    v_gateway,
    'created',
    false,
    jsonb_build_object('source', 'mobile_topup')
  )
  RETURNING id INTO v_order_id;

  RETURN QUERY
  SELECT v_order_id, round(p_amount::numeric, 2), 'created'::text,
    'Top-up order created. Awaiting gateway confirmation.'::text;
END;
$$;

CREATE OR REPLACE FUNCTION ev_get_payment_order_status(
  p_user_id UUID,
  p_payment_order_id UUID
)
RETURNS TABLE (
  payment_order_id UUID,
  amount NUMERIC,
  currency TEXT,
  status TEXT,
  wallet_credited BOOLEAN,
  failure_reason TEXT,
  checkout_url TEXT,
  gateway_name TEXT,
  gateway_order_id TEXT,
  gateway_payment_id TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.amount,
    o.currency,
    o.status,
    o.wallet_credited,
    o.failure_reason,
    o.checkout_url,
    o.gateway_name,
    o.gateway_order_id,
    o.gateway_payment_id,
    o.created_at,
    o.updated_at
  FROM "EV_PaymentOrders" o
  WHERE o.id = p_payment_order_id
    AND o.user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION ev_get_wallet_ledger(
  p_user_id UUID,
  p_limit INT DEFAULT 50,
  p_filter TEXT DEFAULT 'all'
)
RETURNS TABLE (
  id UUID,
  wallet_account_id UUID,
  transaction_type TEXT,
  amount NUMERIC,
  balance_before NUMERIC,
  balance_after NUMERIC,
  reference_type TEXT,
  reference_id UUID,
  remarks TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT
    l.id,
    l.wallet_account_id,
    l.transaction_type,
    l.amount,
    l.balance_before,
    l.balance_after,
    l.reference_type,
    l.reference_id,
    l.remarks,
    l.created_at
  FROM "EV_WalletLedger" l
  WHERE l.user_id = p_user_id
    AND (
      p_filter = 'all'
      OR (p_filter = 'credit' AND l.transaction_type = 'credit')
      OR (p_filter = 'debit' AND l.transaction_type = 'debit')
      OR (p_filter = 'hold' AND l.transaction_type IN ('hold', 'release'))
    )
  ORDER BY l.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
END;
$$;
