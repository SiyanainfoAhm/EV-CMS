-- Review and deploy with database administrator access. Does not mark any bill paid.
BEGIN;
CREATE TABLE IF NOT EXISTS public."EV_DfccilPaymentAttempts" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public."EV_ChargingSessions"(id),
  user_id UUID NOT NULL REFERENCES public."EV_Users"(id),
  payment_id UUID NOT NULL REFERENCES public."EV_Payments"(id),
  virtual_id UUID NOT NULL,
  app_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  nature_of_payment_id INTEGER NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  order_id TEXT UNIQUE,
  checkout_url TEXT,
  creation_state TEXT NOT NULL DEFAULT 'reserved' CHECK (creation_state IN ('reserved','ready','unknown','rejected')),
  resolution TEXT NOT NULL DEFAULT 'open' CHECK (resolution IN ('open','paid','failed','cancelled')),
  reported_status TEXT,
  returned_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  error_kind TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (resolution <> 'paid' OR verified_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ev_dfccil_one_open_bill ON public."EV_DfccilPaymentAttempts"(session_id)
  WHERE resolution IN ('open','paid');
CREATE INDEX IF NOT EXISTS ev_dfccil_user_attempts ON public."EV_DfccilPaymentAttempts"(user_id,created_at DESC);
ALTER TABLE public."EV_DfccilPaymentAttempts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."EV_DfccilPaymentAttempts" FROM PUBLIC, anon, authenticated;
GRANT ALL ON public."EV_DfccilPaymentAttempts" TO service_role;

CREATE OR REPLACE FUNCTION public.ev_dfccil_prepare_payment(
 p_user_id UUID,p_virtual_id UUID,p_session_id UUID,p_app_id TEXT,p_client_id TEXT,p_nature_id INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 s public."EV_ChargingSessions"%ROWTYPE;
 a public."EV_DfccilPaymentAttempts"%ROWTYPE;
 p public."EV_Payments"%ROWTYPE;
 bill RECORD;
 metadata JSONB;
 rate NUMERIC; fee NUMERIC; gst NUMERIC;
 base NUMERIC; tax NUMERIC; total NUMERIC;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public."EV_Users" u WHERE u.id=p_user_id AND u.status='active' AND u.role='User' AND u.sso_sub=p_virtual_id::text) THEN
   RAISE EXCEPTION 'PAYMENT_ACCESS_DENIED';
 END IF;
 SELECT * INTO s FROM public."EV_ChargingSessions" WHERE id=p_session_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
 IF s.end_time IS NULL OR lower(s.status) NOT IN ('completed','stopped','faulted') THEN RAISE EXCEPTION 'BILL_NOT_FINAL'; END IF;
 IF EXISTS (SELECT 1 FROM public."EV_Payments" ep WHERE ep.session_id=s.id AND ep.status IN ('success','paid')) THEN RAISE EXCEPTION 'BILL_ALREADY_PAID'; END IF;
 SELECT * INTO a FROM public."EV_DfccilPaymentAttempts" WHERE session_id=s.id AND resolution IN ('open','paid') LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('created',false,'attempt',to_jsonb(a)); END IF;
 metadata := to_jsonb(s);
 IF lower(COALESCE(metadata->>'payment_status','')) IN ('paid','success','collected','paid_offline') THEN RAISE EXCEPTION 'BILL_REQUIRES_RECONCILIATION'; END IF;
 -- Limits/prepaid* fields never constitute payment evidence. Calculate from server-side usage and tariff.
 rate := NULLIF(metadata->>'rate_per_kwh_snapshot','')::numeric;
 IF rate > 0 THEN
   fee := COALESCE(NULLIF(metadata->>'session_fee_snapshot','')::numeric,0);
   gst := COALESCE(NULLIF(metadata->>'gst_percent_snapshot','')::numeric,0);
   IF fee < 0 OR gst < 0 OR gst > 100 OR s.energy_kwh < 0 THEN RAISE EXCEPTION 'INVALID_BILL'; END IF;
   base := round(COALESCE(s.energy_kwh,0)*rate+fee,2);
   tax := round(base*gst/100,2); total := base+tax;
 ELSE
   IF s.tariff_id IS NULL THEN RAISE EXCEPTION 'BILL_TARIFF_MISSING'; END IF;
   SELECT * INTO bill FROM public.ev_calculate_session_bill(COALESCE(s.energy_kwh,0),s.tariff_id) LIMIT 1;
   base := bill.amount; tax := bill.gst_amount; total := bill.total_amount;
 END IF;
 IF total IS NULL OR total <= 0 OR total <> round(base+tax,2) THEN RAISE EXCEPTION 'INVALID_BILL'; END IF;
 SELECT * INTO p FROM public."EV_Payments" ep WHERE ep.session_id=s.id AND ep.user_id=p_user_id AND ep.status='pending' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF FOUND THEN
   IF COALESCE(to_jsonb(p)->>'gateway_order_id',p.gateway_txn_id,'') <> '' THEN RAISE EXCEPTION 'ANOTHER_PAYMENT_PENDING'; END IF;
   UPDATE public."EV_Payments" SET amount=base,gst_amount=tax,total_amount=total,gateway='dfccil',updated_at=now() WHERE id=p.id;
 ELSE
   INSERT INTO public."EV_Payments"(session_id,user_id,amount,gst_amount,total_amount,status,gateway)
     VALUES(s.id,p_user_id,base,tax,total,'pending','dfccil') RETURNING * INTO p;
 END IF;
 INSERT INTO public."EV_DfccilPaymentAttempts"(session_id,user_id,payment_id,virtual_id,app_id,client_id,nature_of_payment_id,amount)
   VALUES(s.id,p_user_id,p.id,p_virtual_id,p_app_id,p_client_id,p_nature_id,total) RETURNING * INTO a;
 RETURN jsonb_build_object('created',true,'attempt',to_jsonb(a));
END; $$;
REVOKE ALL ON FUNCTION public.ev_dfccil_prepare_payment(UUID,UUID,UUID,TEXT,TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ev_dfccil_prepare_payment(UUID,UUID,UUID,TEXT,TEXT,INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.ev_dfccil_record_return(p_order_id TEXT,p_status TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public."EV_DfccilPaymentAttempts"%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public."EV_DfccilPaymentAttempts" WHERE order_id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- This is an UNSIGNED browser report. No payment/session/receipt is finalized here.
 IF a.verified_at IS NULL THEN
   UPDATE public."EV_DfccilPaymentAttempts" SET
     reported_status=CASE WHEN reported_status='CHARGED' THEN reported_status ELSE p_status END,
     returned_at=COALESCE(returned_at,now()),updated_at=now()
   WHERE id=a.id RETURNING * INTO a;
 END IF;
 RETURN jsonb_build_object('attemptId',a.id,'sessionId',a.session_id,'verified',a.resolution='paid' AND a.verified_at IS NOT NULL);
END; $$;
REVOKE ALL ON FUNCTION public.ev_dfccil_record_return(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ev_dfccil_record_return(TEXT,TEXT) TO service_role;
COMMIT;
