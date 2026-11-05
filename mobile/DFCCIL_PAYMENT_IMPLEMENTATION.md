# DFCCIL mobile payment implementation

Implemented for the current post-charge bill flow. No real payment has been created or charged during implementation. Live order creation is disabled by default. This is not a completed production payment rollout.

## Implemented

- Completed-session bill → create/reuse an authenticated payment attempt → payment status screen → explicit Continue to payment → DFCCIL/CCAvenue browser checkout.
- Fixed server configuration: `https://epay.dfccil.com`, AppId `EV001`, NatureOfPaymentId `30`, SSO client `f51c3d26cd09487eb2350a9742b8af18`.
- Exact registered public return handler: `GET /api/payments/dfccil/return`, intended for `https://ev-cms-rho.vercel.app/api/payments/dfccil/return`.
- Browser return offers an explicit link to `in.dfccil.evcms://payments/dfccil/return?attemptId=...`. This differs from the SSO callback. The app fetches state through the authenticated API and never trusts financial state from a deep link.
- App restart recovery remembers the pending attempt and loads it after authentication. Browser cancellation does not imply that a server payment failed or permit an automatic duplicate payment.
- Authenticated status/history and official PDF receipt endpoints, English/Hindi UI, and official-receipt routing from payment history.
- Amount/time limits no longer cause the DFCCIL payment-summary path to relabel an unpaid bill as paid. Legacy offline and Razorpay code is not used for DFCCIL checkout.

## Backend routes

Protected routes use POST with the EV-CMS SSO Bearer session:

| Route | Input | Result |
| --- | --- | --- |
| `/api/payments/dfccil/config` | `{}` | Provider readiness; no personal details |
| `/api/payments/dfccil/create` | `{ "sessionId": "uuid" }` | Server-created or existing attempt |
| `/api/payments/dfccil/status` | Either `{ "sessionId": "uuid" }` or `{ "attemptId": "uuid" }` | Owned attempt state |
| `/api/payments/dfccil/history` | `{}` | Owned attempts |
| `/api/payments/dfccil/receipt` | `{ "attemptId": "uuid" }` | PDF only for a verified paid attempt |

The public GET return route accepts the gateway's `orderId` and `txnStatus`. Duplicate or malformed parameters are rejected. It requires a known order in the ledger. It does not accept mobile authentication tokens in the URL.

`server/payments/dfccil.js` contains provider operations and the database store; `server/payments/http.js` contains the authenticated HTTP handlers. The local server serves these routes on port 3001 as well as SSO/mobile routes.

## Database migration

Review and apply `supabase/migrations/20261103_dfccil_payment_attempts.sql` through database administrator access before enabling orders. It has not been applied to the shared database by this task.

The migration creates a service-only attempt ledger and two service-only RPCs. The updated legacy create-order edge function rejects new Razorpay orders once this ledger exists; old orders can still use their verification route. The authenticated mobile proxy also blocks legacy order creation when the server is configured for DFCCIL. The reservation RPC:

1. Checks the active user's SSO Virtual ID and ownership of the finished charging session.
2. Locks the session row and permits only one unresolved/paid DFCCIL attempt per bill.
3. Refuses already-paid bills and ambiguous legacy paid metadata.
4. Calculates the final bill from stored usage/tariff snapshots; where snapshots are absent it uses the existing `ev_calculate_session_bill` RPC and tariff ID. This follows the existing tariff billing model; review historical tariff handling before charging older bills.
5. Creates/updates an owned pending payment and reserves an attempt before the external API call.

A duplicate reservation reuses the existing attempt. An interrupted/timeout/ambiguous create remains unresolved and is not automatically retried. Documented HTTP 400 problem+json pre-order validation rejections are recorded as failed attempts; a user may retry after fixing configuration. The external provider does not document an idempotency key or lookup API, so crashes between reservation, creation and persistence require gateway reconciliation.

The return RPC locks the attempt and records an **unsigned report**. It does not create receipts, mark `EV_Payments` successful, change session payment status or grant fulfillment. A verified paid attempt cannot be downgraded by a later browser return.

## Authoritative success verification (complete HTML guide)

The complete HTML guide adds `GET /Payment/Status/{orderId}`. The authenticated mobile status endpoint fetches this fixed HTTPS URL, validates order ID, App ID, positive amount and consistent status/statusGroup, then calls the service-only `ev_dfccil_finalize_status` RPC. Only SUCCESS + CHARGED settles the frozen bill. The transaction locks session, attempt and payment, checks ownership/amount/reference consistency, updates EV_Payments to success and session payment_status to paid, and records verified_at. Duplicates are idempotent and success cannot be downgraded.

`ev_dfccil_claim_status` enforces one check per order per 30 seconds across devices/instances using a persisted lease/token. Mobile automatic polling is 30 seconds; manual refreshes use the same server lease. Timeouts, malformed replies, unknown orders and reference/amount discrepancies never settle the bill or release it for another payment. Verified failures/cancellations permit a new order; AMOUNT_MISMATCH remains blocked. A late old-order success conflicting with a new active attempt requires reconciliation.

Unsigned browser return values remain reports only. Returning/restarting the app performs an authenticated status refresh; there is no background scheduled reconciler. The PDF endpoint now documents failed transaction records too, so PDF availability is never used as proof. The application offers the official payment receipt only for a verified successful order and does not invent a receipt number.

Apply `supabase/migrations/20261103_dfccil_payment_verification.sql` after the attempt-ledger migration, including when the older migration has already been applied.

## Deployment and configuration

Server-only values are listed in `server/payments/dfccil.env.example`. Defaults match the client's supplied registration. Root `.env` contains the local configuration with live order creation disabled. The mobile `.env` enables the UI feature; this alone cannot enable gateway orders.

```dotenv
DFCCIL_PAYMENTS_ENABLED=false
DFCCIL_PAYMENT_BASE_URL=https://epay.dfccil.com
DFCCIL_PAYMENT_APP_ID=EV001
DFCCIL_NATURE_OF_PAYMENT_ID=30
DFCCIL_PAYMENT_RETURN_URL=https://ev-cms-rho.vercel.app/api/payments/dfccil/return
```

Mobile feature:

```dotenv
EXPO_PUBLIC_DFCCIL_PAYMENTS_ENABLED=true
```

The client confirmed nature ID 30. The complete HTML guide specifies a string request field, so creation sends `NatureOfPaymentId: "30"`.

Deploy the API routes to the actual Vercel project serving the registered callback domain. A callback registration does not deploy its handler. The current local development server cannot receive a production callback at that domain, and the deployed callback and local create service must use the same database. No remote deployment was performed.

Use root `vercel.json` for the restored dashboard and backend together; see `DEPLOYMENT.md`.

## Checks and remaining setup

```bash
npm run check:payments
```

The latest run passed 103 tests. This runs backend SSO/authorization/payment tests, isolated PostgreSQL migration/financial-state tests, and mobile TypeScript checks. Gateway calls in tests are controlled fixtures; they do not contact the live payment API.

Still required: shared database migration, coordinated removal of direct legacy database/RPC access, public callback/backend deployment, and approval for controlled small-value real payment testing. The implemented collection timing is after charging; client approval of that business rule is still needed before rollout.

Local smoke checks: unauthenticated create requests return HTTP 401; a return without required parameters returns HTTP 400; the updated Android bundle loads. The updated legacy edge function passes `deno check`. No live order was created, and the migration remains unapplied to the shared database.
