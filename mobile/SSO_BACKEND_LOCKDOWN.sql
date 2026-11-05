-- DEPLOYMENT CUTOVER: run only after every EV-CMS client uses authenticated backend routes.
-- This removes legacy direct anon/authenticated access, including the sibling web app.
-- No user or transaction rows are deleted. Existing policies cannot override these revocations.
BEGIN;
DO $$
DECLARE record RECORD;
BEGIN
  FOR record IN SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname LIKE 'EV\_%' ESCAPE '\' AND c.relkind IN ('r','p','v','m')
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM PUBLIC, anon, authenticated', record.nspname, record.relname);
    EXECUTE format('GRANT ALL ON TABLE %I.%I TO service_role', record.nspname, record.relname);
  END LOOP;
  FOR record IN SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND (p.proname ~ '(^ev_|_ev_|_for_sso$)' OR p.prosrc LIKE '%EV\_%' ESCAPE '\')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated', record.nspname, record.proname, record.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role', record.nspname, record.proname, record.args);
  END LOOP;
END;
$$;
UPDATE storage.buckets SET public = false WHERE id = 'ev-media';
DROP POLICY IF EXISTS ev_media_backend_only ON storage.objects;
CREATE POLICY ev_media_backend_only ON storage.objects AS RESTRICTIVE
  FOR ALL TO anon, authenticated USING (bucket_id <> 'ev-media') WITH CHECK (bucket_id <> 'ev-media');
COMMIT;
-- Verify direct anon reads, writes and RPC execution are denied after deployment.
-- Signed storage download URLs remain short-lived bearer URLs; current lifetime is five minutes.
