-- Admin web: allow status / priority / assignee updates on support tickets (demo anon key).
-- Production: use service role API or authenticated admin roles.

DROP POLICY IF EXISTS "ev_anon_update_support_tickets" ON "EV_SupportTickets";
CREATE POLICY "ev_anon_update_support_tickets" ON "EV_SupportTickets"
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);
