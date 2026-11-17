# Real DFCCIL production checkout: INR 1

This feature creates a real standalone INR 1 payment using `https://epay.dfccil.com`. It does not simulate the gateway. The payer enters payment details on the provider's checkout; available methods and minimum amounts are determined by DFCCIL. It does not create a charging session, settle a charging bill or provide an automatic refund.

## Deployment

1. Review and apply `supabase/migrations/20261117_dfccil_production_test.sql` to the existing database. This creates a private, service-role-only test ledger and reservation/verification functions. Do not run seed scripts.
2. Merge the feature branch to main so Vercel deploys `/api/payments/production-test` and the updated existing payment return handler. The mock and production-test URL aliases share the existing configuration handler through Vercel rewrites, keeping the deployment within 12 functions.
3. Set `DFCCIL_PRODUCTION_TEST_ENABLED=true` in Vercel Production and redeploy. Existing SSO, service-role and DFCCIL configuration are reused. Keep the registered `DFCCIL_PAYMENT_RETURN_URL`; no new provider callback registration is needed. This dedicated flag does not enable charging-bill payments.
4. Run the updated mobile development build, sign in with the intended DFCCIL User account, and open any charger.

## Test

Tap **Test real DFCCIL payment · ₹1**. Review the real-money notice, tap **Create real ₹1 payment order**, and confirm. Then tap **Open DFCCIL checkout · ₹1 real payment**. Enter payment details only on the DFCCIL/provider checkout. The feature does not collect card numbers in EV-CMS.

Return to the app and refresh payment status. If needed, wait 30 seconds between checks. Only a matching order ID, App ID, amount and `SUCCESS` / `CHARGED` from DFCCIL's authenticated server-side status lookup is shown as confirmed. The browser return alone cannot mark a test paid. If the browser stays on the gateway, close it and refresh manually.

Reopening this screen restores the order from the server, including after an app restart or reinstall. The database allows only one test order per user, including failed, cancelled, ambiguous and paid attempts. Double taps or retries return that existing order. Do not delete records to retry an uncertain charge; reconcile the reference first. No real order is created by tests or deployment.

Disable `DFCCIL_PRODUCTION_TEST_ENABLED` and redeploy after the controlled test. Status lookup remains available for reconciliation. Keep the test ledger for accounting/refund follow-up; it is separate from charging payment history. An administrator must arrange any refund through the provider's normal process.

## Limits

DFCCIL may reject INR 1 or the standalone description under the existing EV001/nature-of-payment mapping. Do not relabel the test as a charging bill to bypass rejection. Provider acceptance, available payment methods and settlement must be confirmed by the actual checkout. No live payment has been made as part of implementation.

Validation: `npm --prefix mobile run typecheck`; `node --test tests/production-payment-test.test.js tests/dfccil-payment.test.js tests/dfccil-payment-sql.test.js tests/sso.test.js tests/mobile-authorization.test.js`.
