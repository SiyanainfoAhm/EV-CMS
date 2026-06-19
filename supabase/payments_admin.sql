-- Admin web: payment verify, reconcile, receipt insert (demo anon key).
-- Production: use service role API or Edge Function webhooks.

DROP POLICY IF EXISTS "ev_anon_update_payments" ON "EV_Payments";
CREATE POLICY "ev_anon_update_payments" ON "EV_Payments"
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_insert_receipts" ON "EV_Receipts";
CREATE POLICY "ev_anon_insert_receipts" ON "EV_Receipts"
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);
