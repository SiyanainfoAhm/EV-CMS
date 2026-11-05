-- Apply after 20261104_dfccil_payment_attempts.sql. Backend/service-role only.
BEGIN;
ALTER TABLE public."EV_DfccilPaymentAttempts"
 ADD COLUMN IF NOT EXISTS status_checked_at timestamptz,
 ADD COLUMN IF NOT EXISTS status_check_token uuid,
 ADD COLUMN IF NOT EXISTS gateway_status text,
 ADD COLUMN IF NOT EXISTS gateway_status_group text,
 ADD COLUMN IF NOT EXISTS has_receipt boolean NOT NULL DEFAULT false;

-- A database-backed lease rate-limits checks across devices and server instances.
CREATE OR REPLACE FUNCTION public.ev_dfccil_claim_status(p_attempt_id uuid,p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public."EV_DfccilPaymentAttempts"%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public."EV_DfccilPaymentAttempts" WHERE id=p_attempt_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_NOT_FOUND'; END IF;
 IF a.order_id IS NULL OR a.resolution='paid' OR a.status_checked_at > clock_timestamp()-interval '30 seconds' THEN
  RETURN jsonb_build_object('check',false,'attempt',to_jsonb(a));
 END IF;
 UPDATE public."EV_DfccilPaymentAttempts" SET status_checked_at=clock_timestamp(),status_check_token=gen_random_uuid()
 WHERE id=a.id RETURNING * INTO a;
 RETURN jsonb_build_object('check',true,'attempt',to_jsonb(a));
END; $$;

CREATE OR REPLACE FUNCTION public.ev_dfccil_finalize_status(p_attempt_id uuid,p_check_token uuid,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public."EV_DfccilPaymentAttempts"%ROWTYPE; p public."EV_Payments"%ROWTYPE;
 sid uuid; state text; grp text; total numeric;
BEGIN
 SELECT session_id INTO sid FROM public."EV_DfccilPaymentAttempts" WHERE id=p_attempt_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_NOT_FOUND'; END IF;
 -- Same lock order as reservation: session, attempt, payment.
 PERFORM 1 FROM public."EV_ChargingSessions" WHERE id=sid FOR UPDATE;
 SELECT * INTO a FROM public."EV_DfccilPaymentAttempts" WHERE id=p_attempt_id FOR UPDATE;
 IF a.resolution='paid' THEN RETURN to_jsonb(a); END IF;
 IF p_check_token IS NULL OR a.status_check_token IS DISTINCT FROM p_check_token THEN RAISE EXCEPTION 'STALE_STATUS_CHECK'; END IF;
 state:=p_result->>'status'; grp:=p_result->>'statusGroup';
 IF p_result->>'orderId' IS DISTINCT FROM a.order_id OR p_result->>'appId' IS DISTINCT FROM a.app_id
 OR jsonb_typeof(p_result->'amount') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'GATEWAY_REFERENCE_MISMATCH'; END IF;
 total:=(p_result->>'amount')::numeric;
 IF total IS DISTINCT FROM a.amount OR total<=0 THEN RAISE EXCEPTION 'GATEWAY_AMOUNT_MISMATCH'; END IF;
 IF state IS NULL OR grp IS NULL OR NOT ((grp='SUCCESS' AND state='CHARGED') OR (grp='FAILED' AND state IN ('FAILED','CANCELLED','TIMEOUT','AMOUNT_MISMATCH'))
 OR (grp='PENDING' AND state IN ('INITIATED','PaymentLinkUsed'))) THEN RAISE EXCEPTION 'GATEWAY_STATUS_INVALID'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public."EV_ChargingSessions" WHERE id=sid AND user_id=a.user_id) THEN RAISE EXCEPTION 'SESSION_OWNER_MISMATCH'; END IF;
 SELECT * INTO p FROM public."EV_Payments" WHERE id=a.payment_id FOR UPDATE;
 IF NOT FOUND OR p.session_id<>a.session_id OR p.user_id<>a.user_id OR p.total_amount<>a.amount OR p.gateway IS DISTINCT FROM 'dfccil' THEN RAISE EXCEPTION 'PAYMENT_RECORD_MISMATCH'; END IF;
 IF EXISTS (SELECT 1 FROM public."EV_Payments" WHERE session_id=sid AND id<>p.id AND status IN ('success','paid')) THEN RAISE EXCEPTION 'BILL_ALREADY_PAID'; END IF;
 IF grp='SUCCESS' THEN
  -- A different active attempt requires reconciliation; never settle two orders for a bill.
  IF EXISTS (SELECT 1 FROM public."EV_DfccilPaymentAttempts" WHERE session_id=sid AND id<>a.id AND resolution IN ('open','paid')) THEN RAISE EXCEPTION 'BILL_REQUIRES_RECONCILIATION'; END IF;
  UPDATE public."EV_Payments" SET status='success',updated_at=now() WHERE id=p.id;
  UPDATE public."EV_ChargingSessions" SET payment_status='paid',amount=a.amount WHERE id=sid;
 ELSIF grp='FAILED' AND state<>'AMOUNT_MISMATCH' THEN
  UPDATE public."EV_Payments" SET status='failed',updated_at=now() WHERE id=p.id AND status NOT IN ('success','paid');
 END IF;
 UPDATE public."EV_DfccilPaymentAttempts" SET
  gateway_status=state,gateway_status_group=grp,reported_status=state,
  has_receipt=COALESCE((p_result->>'hasReceipt')::boolean,false),
  resolution=CASE WHEN grp='SUCCESS' THEN 'paid' WHEN state='CANCELLED' THEN 'cancelled'
   WHEN grp='FAILED' AND state<>'AMOUNT_MISMATCH' THEN 'failed' ELSE resolution END,
  verified_at=CASE WHEN grp='SUCCESS' THEN now() ELSE verified_at END,
  error_kind=CASE WHEN state='AMOUNT_MISMATCH' THEN 'gateway_amount_mismatch' ELSE NULL END,
  updated_at=now()
 WHERE id=a.id RETURNING * INTO a;
 -- Official receipt PDF stays at the gateway; do not invent a receipt number or expose its URL.
 RETURN to_jsonb(a);
END; $$;
REVOKE ALL ON FUNCTION public.ev_dfccil_claim_status(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ev_dfccil_finalize_status(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ev_dfccil_claim_status(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ev_dfccil_finalize_status(uuid,uuid,jsonb) TO service_role;
COMMIT;
