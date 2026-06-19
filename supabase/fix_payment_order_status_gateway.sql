-- Include Razorpay gateway IDs in payment-order status RPC (run in Supabase SQL Editor).

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

GRANT EXECUTE ON FUNCTION ev_get_payment_order_status(UUID, UUID) TO anon, authenticated;
