# Standalone payment mock

Merge this branch to main to deploy the API through the existing Vercel integration. Set `PAYMENT_MOCK_ENABLED=true` in the intended Vercel environment and redeploy. Existing SSO environment variables are required. Disable the flag when testing finishes. No migrations or gateway credentials are required.

Start the mobile development build using RUNNING.md. Sign in, open any charger, and tap **Test mock payment (temporary)**. Create a ₹1 mock order, simulate an outcome, and refresh its status. Create another order for each outcome. Close and reopen the app, return to the test screen, and refresh to test restoration. A pending order can later resolve to success, failure or cancellation. A simulated success is explicitly labelled and has no official receipt.

The client calls the configured production Vercel `/api/payments/mock` endpoint using its real SSO session. The endpoint is authenticated, disabled by default, and never calls the gateway or writes charging/payment records. The screen and entry button exist only in development builds. Neither the live DFCCIL payment feature flag nor the live payment APIs are changed.

Mock references are signed, bound to the signed-in user, stored locally per user and expire after 24 hours. This is a stateless test harness: an older pending reference can be replayed to explore a different outcome, and losing local storage loses the test history. It does not model a durable gateway ledger, real checkout UI, external callback delivery, payment-provider connectivity or actual settlement. The production payment path remains separate. Real-provider testing is still required before release.

Validation: `npm --prefix mobile run typecheck` and `node --test tests/payment-mock.test.js tests/sso.test.js tests/mobile-authorization.test.js`.
