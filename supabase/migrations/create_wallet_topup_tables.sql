-- EV CMS Wallet & Top-up schema (prepaid wallet readiness — no gateway credit from mobile).
-- References EV_Users (custom auth — not auth.users).
-- Run in Supabase SQL Editor or via: supabase db push

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "EV_WalletAccounts" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "EV_Users"(id) ON DELETE CASCADE,
  balance_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  hold_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ev_wallet_accounts_user_unique UNIQUE (user_id),
  CONSTRAINT ev_wallet_accounts_balance_nonneg CHECK (balance_amount >= 0),
  CONSTRAINT ev_wallet_accounts_hold_nonneg CHECK (hold_amount >= 0),
  CONSTRAINT ev_wallet_accounts_hold_lte_balance CHECK (hold_amount <= balance_amount),
  CONSTRAINT ev_wallet_accounts_status_check CHECK (status IN ('active', 'blocked', 'closed'))
);

CREATE TABLE IF NOT EXISTS "EV_WalletLedger" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_account_id UUID NOT NULL REFERENCES "EV_WalletAccounts"(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES "EV_Users"(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  balance_before NUMERIC(12, 2) NOT NULL DEFAULT 0,
  balance_after NUMERIC(12, 2) NOT NULL DEFAULT 0,
  reference_type TEXT NOT NULL,
  reference_id UUID NULL,
  remarks TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ev_wallet_ledger_tx_type_check CHECK (
    transaction_type IN ('credit', 'debit', 'hold', 'release', 'refund', 'adjustment')
  ),
  CONSTRAINT ev_wallet_ledger_ref_type_check CHECK (
    reference_type IN ('topup', 'payment_order', 'charging_session', 'refund', 'admin_adjustment', 'hold', 'release')
  )
);

CREATE TABLE IF NOT EXISTS "EV_PaymentOrders" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "EV_Users"(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  gateway_name TEXT NULL,
  gateway_order_id TEXT NULL,
  gateway_payment_id TEXT NULL,
  checkout_url TEXT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  wallet_credited BOOLEAN NOT NULL DEFAULT FALSE,
  failure_reason TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ev_payment_orders_amount_min CHECK (amount >= 100),
  CONSTRAINT ev_payment_orders_status_check CHECK (
    status IN ('created', 'pending', 'paid', 'failed', 'cancelled', 'expired')
  )
);

CREATE TABLE IF NOT EXISTS "EV_PaymentTransactions" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_order_id UUID NOT NULL REFERENCES "EV_PaymentOrders"(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES "EV_Users"(id) ON DELETE CASCADE,
  gateway_name TEXT NULL,
  gateway_order_id TEXT NULL,
  gateway_payment_id TEXT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL,
  raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "EV_PaymentWebhooks" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_name TEXT NULL,
  event_type TEXT NULL,
  gateway_order_id TEXT NULL,
  gateway_payment_id TEXT NULL,
  signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ev_wallet_accounts_user_id ON "EV_WalletAccounts" (user_id);
CREATE INDEX IF NOT EXISTS idx_ev_wallet_ledger_user_id ON "EV_WalletLedger" (user_id);
CREATE INDEX IF NOT EXISTS idx_ev_wallet_ledger_wallet_id ON "EV_WalletLedger" (wallet_account_id);
CREATE INDEX IF NOT EXISTS idx_ev_payment_orders_user_id ON "EV_PaymentOrders" (user_id);
CREATE INDEX IF NOT EXISTS idx_ev_payment_orders_status ON "EV_PaymentOrders" (status);
CREATE INDEX IF NOT EXISTS idx_ev_payment_transactions_order_id ON "EV_PaymentTransactions" (payment_order_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE "EV_WalletAccounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_WalletLedger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_PaymentOrders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_PaymentTransactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_PaymentWebhooks" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ev_wallet_accounts_select_own" ON "EV_WalletAccounts";
CREATE POLICY "ev_wallet_accounts_select_own" ON "EV_WalletAccounts"
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_wallet_ledger_select_own" ON "EV_WalletLedger";
CREATE POLICY "ev_wallet_ledger_select_own" ON "EV_WalletLedger"
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_payment_orders_select_own" ON "EV_PaymentOrders";
CREATE POLICY "ev_payment_orders_select_own" ON "EV_PaymentOrders"
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_payment_transactions_select_own" ON "EV_PaymentTransactions";
CREATE POLICY "ev_payment_transactions_select_own" ON "EV_PaymentTransactions"
  FOR SELECT TO anon, authenticated USING (true);

-- No mobile access to webhooks
DROP POLICY IF EXISTS "ev_payment_webhooks_deny_all" ON "EV_PaymentWebhooks";
CREATE POLICY "ev_payment_webhooks_deny_all" ON "EV_PaymentWebhooks"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- Deny direct wallet balance / ledger writes from mobile roles
DROP POLICY IF EXISTS "ev_wallet_accounts_no_client_write" ON "EV_WalletAccounts";
CREATE POLICY "ev_wallet_accounts_no_client_write" ON "EV_WalletAccounts"
  FOR INSERT TO anon, authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "ev_wallet_accounts_no_client_update" ON "EV_WalletAccounts";
CREATE POLICY "ev_wallet_accounts_no_client_update" ON "EV_WalletAccounts"
  FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "ev_wallet_ledger_no_client_write" ON "EV_WalletLedger";
CREATE POLICY "ev_wallet_ledger_no_client_write" ON "EV_WalletLedger"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "ev_payment_orders_no_client_insert" ON "EV_PaymentOrders";
CREATE POLICY "ev_payment_orders_no_client_insert" ON "EV_PaymentOrders"
  FOR INSERT TO anon, authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "ev_payment_orders_no_client_update" ON "EV_PaymentOrders";
CREATE POLICY "ev_payment_orders_no_client_update" ON "EV_PaymentOrders"
  FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "ev_payment_transactions_no_client_write" ON "EV_PaymentTransactions";
CREATE POLICY "ev_payment_transactions_no_client_write" ON "EV_PaymentTransactions"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- RPC helpers (SECURITY DEFINER — mobile passes EV_Users.id as p_user_id)
-- ---------------------------------------------------------------------------

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

GRANT EXECUTE ON FUNCTION ev_get_or_create_wallet_account(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_get_wallet_summary(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_create_topup_order(UUID, NUMERIC, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_get_payment_order_status(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_get_wallet_ledger(UUID, INT, TEXT) TO anon, authenticated;
