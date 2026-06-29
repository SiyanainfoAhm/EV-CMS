-- Web admin: read wallet top-ups and balances (run after create_wallet_topup_tables.sql)
-- Demo/UAT uses anon key — production should use role-scoped API.

DROP POLICY IF EXISTS "ev_anon_select_wallet_accounts" ON "EV_WalletAccounts";
CREATE POLICY "ev_anon_select_wallet_accounts" ON "EV_WalletAccounts"
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_select_wallet_ledger" ON "EV_WalletLedger";
CREATE POLICY "ev_anon_select_wallet_ledger" ON "EV_WalletLedger"
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_select_payment_orders" ON "EV_PaymentOrders";
CREATE POLICY "ev_anon_select_payment_orders" ON "EV_PaymentOrders"
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_select_payment_transactions" ON "EV_PaymentTransactions";
CREATE POLICY "ev_anon_select_payment_transactions" ON "EV_PaymentTransactions"
  FOR SELECT TO anon, authenticated USING (true);
