-- Standalone real INR 1 payments. No charging sessions or bills are created/updated.
BEGIN;
CREATE TABLE IF NOT EXISTS public."EV_DfccilProductionTests" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL UNIQUE REFERENCES public."EV_Users"(id),
 virtual_id uuid NOT NULL, app_id text NOT NULL, nature_of_payment_id integer NOT NULL,
 amount numeric(12,2) NOT NULL DEFAULT 1 CHECK (amount=1),
 order_id text UNIQUE, checkout_url text,
 creation_state text NOT NULL DEFAULT 'reserved' CHECK (creation_state IN ('reserved','ready','unknown','rejected')),
 resolution text NOT NULL DEFAULT 'open' CHECK (resolution IN ('open','paid','failed','cancelled')),
 reported_status text, gateway_status text, gateway_status_group text,
 verified_at timestamptz, status_checked_at timestamptz, status_check_token uuid,
 has_receipt boolean NOT NULL DEFAULT false, error_kind text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (resolution<>'paid' OR verified_at IS NOT NULL)
);
ALTER TABLE public."EV_DfccilProductionTests" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."EV_DfccilProductionTests" FROM PUBLIC,anon,authenticated;
GRANT ALL ON public."EV_DfccilProductionTests" TO service_role;

CREATE OR REPLACE FUNCTION public.ev_dfccil_test_reserve(p_user_id uuid,p_virtual_id uuid,p_app_id text,p_nature_id integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public."EV_DfccilProductionTests"%ROWTYPE; made boolean;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public."EV_Users" WHERE id=p_user_id AND status='active' AND role='User' AND sso_sub=p_virtual_id::text) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 INSERT INTO public."EV_DfccilProductionTests" (user_id,virtual_id,app_id,nature_of_payment_id)
 VALUES (p_user_id,p_virtual_id,p_app_id,p_nature_id) ON CONFLICT (user_id) DO NOTHING RETURNING * INTO a;
 made:=FOUND;
 IF NOT made THEN SELECT * INTO a FROM public."EV_DfccilProductionTests" WHERE user_id=p_user_id; END IF;
 RETURN jsonb_build_object('created',made,'attempt',to_jsonb(a));
END; $$;

CREATE OR REPLACE FUNCTION public.ev_dfccil_test_claim(p_user_id uuid,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public."EV_DfccilProductionTests"%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public."EV_DfccilProductionTests" WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF a.order_id IS NULL OR a.resolution='paid' OR a.status_checked_at>clock_timestamp()-interval '30 seconds' THEN RETURN jsonb_build_object('check',false,'attempt',to_jsonb(a)); END IF;
 UPDATE public."EV_DfccilProductionTests" SET status_checked_at=clock_timestamp(),status_check_token=gen_random_uuid() WHERE id=p_id RETURNING * INTO a;
 RETURN jsonb_build_object('check',true,'attempt',to_jsonb(a));
END; $$;

CREATE OR REPLACE FUNCTION public.ev_dfccil_test_finalize(p_id uuid,p_token uuid,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public."EV_DfccilProductionTests"%ROWTYPE; state text; grp text;
BEGIN
 SELECT * INTO a FROM public."EV_DfccilProductionTests" WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF a.resolution='paid' THEN RETURN to_jsonb(a); END IF;
 IF p_token IS NULL OR a.status_check_token IS DISTINCT FROM p_token THEN RAISE EXCEPTION 'STALE_CHECK'; END IF;
 IF p_result->>'orderId' IS DISTINCT FROM a.order_id OR p_result->>'appId' IS DISTINCT FROM a.app_id
 OR jsonb_typeof(p_result->'amount') IS DISTINCT FROM 'number' OR (p_result->>'amount')::numeric IS DISTINCT FROM a.amount THEN RAISE EXCEPTION 'REFERENCE_MISMATCH'; END IF;
 state:=p_result->>'status'; grp:=p_result->>'statusGroup';
 IF state IS NULL OR grp IS NULL OR NOT ((grp='SUCCESS' AND state='CHARGED') OR (grp='FAILED' AND state IN ('FAILED','CANCELLED','TIMEOUT','AMOUNT_MISMATCH')) OR (grp='PENDING' AND state IN ('INITIATED','PaymentLinkUsed'))) THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
 UPDATE public."EV_DfccilProductionTests" SET gateway_status=state,gateway_status_group=grp,reported_status=state,
 resolution=CASE WHEN grp='SUCCESS' THEN 'paid' WHEN state='CANCELLED' THEN 'cancelled' WHEN grp='FAILED' AND state<>'AMOUNT_MISMATCH' THEN 'failed' ELSE resolution END,
 verified_at=CASE WHEN grp='SUCCESS' THEN now() ELSE verified_at END,has_receipt=COALESCE((p_result->>'hasReceipt')::boolean,false),updated_at=now()
 WHERE id=p_id RETURNING * INTO a;
 RETURN to_jsonb(a);
END; $$;
REVOKE ALL ON FUNCTION public.ev_dfccil_test_reserve(uuid,uuid,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ev_dfccil_test_claim(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ev_dfccil_test_finalize(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ev_dfccil_test_reserve(uuid,uuid,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ev_dfccil_test_claim(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ev_dfccil_test_finalize(uuid,uuid,jsonb) TO service_role;
COMMIT;
