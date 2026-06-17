DROP POLICY IF EXISTS "ev_anon_insert_support" ON "EV_SupportTickets";
CREATE POLICY "ev_anon_insert_support" ON "EV_SupportTickets"
  FOR INSERT TO anon, authenticated WITH CHECK (true);
