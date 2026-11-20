# Real DFCCIL INR 1 checkout without a payment database

Only the standalone payment test skips database storage. Existing SSO still uses the existing Supabase configuration. No new migration or Supabase administrative access is required. The normal charging-bill payment flow is unchanged.

Merge the feature branch to main, set `DFCCIL_PRODUCTION_TEST_ENABLED=true` and the server-only `DFCCIL_MOBILE_EPAY_HEADER` credential in Vercel Production, then redeploy. Keep the existing DFCCIL gateway and registered return URL. The credential is sent as the `mobile-epay` header only by server-to-server requests; never add it to mobile configuration, `VITE_` variables, or source control. The test API uses the existing SSO signing secret with a separate token issuer/audience; do not rotate that secret during the test. Previously applied test-ledger migrations can remain; this implementation does not access that table.

In the development app, open a charger and tap **Test real DFCCIL payment · ₹1**. Refresh status, create the order and confirm, then open checkout. Enter real payment details only in the provider checkout. This charges real money if completed, and offers no automatic refund.

Before creating the gateway order, the server signs an INR 1 test reference tied to the SSO user/Virtual ID. The app saves that reference and a creating marker before sending the create request. The resulting signed order reference is retained locally per account. Reopen the screen to restore it and refresh status. Only a matching gateway order/App ID/amount with SUCCESS and CHARGED verifies success. The unsigned return never confirms payment. If the return page stays open, close it and refresh manually. Wait 30 seconds between status checks.

## Controlled-test limitations

Signed references expire after 7 days. Do not clear app data, reinstall, switch devices or rotate the signing secret during the test. Copy the displayed gateway order ID for reconciliation. There is no server payment ledger, cross-device recovery or server-side exactly-once creation guarantee. A prepared reference can be replayed outside the app, and the backend cannot globally rate-limit checks without storage. This is not the production billing architecture.

The app prevents duplicate taps and persists a creating marker before the gateway request. An interrupted create remains blocked; do not clear local data to retry an uncertain charge. Contact support/provider to reconcile first. An order ID lost with the creation response cannot be recovered automatically. Status remains available with a valid reference when the create feature flag is disabled.

After the controlled test, disable `DFCCIL_PRODUCTION_TEST_ENABLED` and redeploy. Normal production charging payments retain their database ledger. No real gateway order is created by automated tests.

Validation: `npm --prefix mobile run typecheck`; `node --test tests/production-payment-test.test.js tests/dfccil-payment.test.js tests/dfccil-payment-sql.test.js tests/sso.test.js tests/mobile-authorization.test.js tests/payment-mock.test.js`; `npm run check:deployment`.

## Gateway TLS chain

The gateway was observed sending only its wildcard leaf certificate on 2026-11-17. The payment transport now supplies the missing GlobalSign GCC R46 OV TLS CA 2025 intermediate only for `https://epay.dfccil.com`. It retains Node's bundled roots, normal hostname/expiry/signature checks and rejection of redirects. No global TLS settings change.

The public certificate is embedded in `server/payments/globalsign-intermediate.js` to ensure serverless bundling includes it. It was obtained over verified HTTPS from `https://secure.globalsign.com/cacert/gsgccr46ovtlsca2025.crt`; its SHA-256 fingerprint and trusted-root signature are tested. It expires on 2029-06-23. Revalidate this workaround when DFCCIL rotates its chain; prefer the provider serving a complete chain.

A local read-only status probe now passes TLS verification and receives HTTP 403 from Azure Application Gateway. That HTTP response is distinct from the certificate failure and does not establish how Vercel egress will be handled. After merging/deploying, use **Check gateway connection (no payment)** before attempting checkout. No real order was created to validate the TLS fix.
