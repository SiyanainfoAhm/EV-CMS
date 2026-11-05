> Update: the complete HTML guide supplies GET /Payment/Status/{orderId}, 30-second polling, string NatureOfPaymentId, and PDFs for failed outcomes as well as success. Server-side verification and atomic finalization are now implemented; see DFCCIL_PAYMENT_IMPLEMENTATION.md and DEPLOYMENT.md. The original analysis below reflects the older PDF.

> Implementation has since been added. See `DFCCIL_PAYMENT_IMPLEMENTATION.md` for current code, verification limits, migration and deployment status. The analysis below records the starting state.

# DFCCIL payment gateway integration map

Reviewed: 4 November 2026. Scope: current repository mobile screens/services, API/backend authorization, local SQL/edge functions, routing/deployment configuration and tests. The sibling `../EV-CMS-main-src` was inspected as a reference for web payment adapters and database definitions missing from this working copy. This is a source-code analysis, not verification of the deployed Vercel application or live database schema. No live payment was created and no payment status was changed.

## Main finding

The active mobile flow is **charge first, display the bill afterward, collect payment offline**. DFCCIL online checkout fits most naturally on the completed-session bill screen. This is a recommendation based on the existing code, not confirmation of the client's business policy. Prepayment would require a different charging/payment workflow and should not be enabled merely by reactivating the legacy Razorpay methods.

Current path:

```text
ChargerDetailScreen / QRStartScreen
  → chargingService.startChargingWithSessionLimit
  → sessionService + authorized OCPP gateway
  → LiveSessionScreen
  → stop / session completion / bill synchronization
  → SessionSummaryScreen
  → offline collection status and receipt actions
```

Amount/time selection is a session limit. The `prepaid*` names in several services and columns are historical and do not establish that the user has paid.

## Confirmed gateway configuration

| Item | Supplied value |
| --- | --- |
| Base URL | `https://epay.dfccil.com` |
| AppId | `EV001` |
| NatureOfPaymentId | `30` |
| Virtual ID mode | Enabled, per client confirmation |
| Registered payment Return URL | `https://ev-cms-rho.vercel.app/api/payments/dfccil/return` |
| SSO ClientId | `f51c3d26cd09487eb2350a9742b8af18` |
| Create payment | `POST /Payment/SavePaymentData` |
| Hosted checkout | Returned `paymentUrl`, normally `/Payment/Pay/{orderId}` |
| Gateway receipt | `GET /Payment/GetReceipt/{orderId}` |

The supplied PDF specifies string `PaymentNature`; the client supplied numeric `NatureOfPaymentId`. The client has now confirmed the actual create-request field `NatureOfPaymentId: 30`; preserve this value in configuration. Do not silently substitute a merchant ID, Razorpay key or HDFC credential for AppId. The gateway handles CCAvenue encryption and card entry; this application integrates with the DFCCIL wrapper, not directly with CCAvenue.

## Mobile integration points

| File | Existing behavior | Required change |
| --- | --- | --- |
| `src/screens/SessionSummaryScreen.tsx` | Loads session, payment and receipt; hardcodes offline labels; no Pay Now action | Primary post-charge checkout entry: show Pay Now only for an owned, finalized, unpaid bill; open checkout and refresh authoritative status after return |
| `src/utils/sessionCompletion.ts` | `shouldShowPostSessionPayment()` always returns false; amount/time limits classify sessions as prepaid/offline; successful statuses render Paid Offline | Separate session limits, verified online payment and offline collection; derive pay eligibility from authoritative financial state |
| `src/services/paymentService.ts` | History and summary queries coexist with legacy Razorpay prepayment/checkout | Add provider-neutral DFCCIL order/status methods; retain history, replace checkout dispatch; remove false paid inference for limited sessions |
| `src/services/sessionPaymentService.ts` | Maps only Razorpay create/verify edge functions | Add authenticated DFCCIL API calls instead of reusing Razorpay signature payloads |
| `src/services/paymentGatewayConfigService.ts` | Accepts only razorpay/hdfc; missing/unknown configuration falls back to Razorpay testing | Add an explicit DFCCIL provider and fail closed when configured provider is unavailable; update corresponding backend config parsing |
| `src/config/paymentConfig.ts` | Readiness is mostly Razorpay/native-key based | Add DFCCIL readiness/configuration; do not require a Razorpay key or SDK to use hosted checkout |
| `src/screens/SessionPaymentStatusScreen.tsx` | Route and retry state depend on Razorpay order/payment IDs | Generalize to local payment ID, DFCCIL order ID and authoritative attempt status; create a fresh gateway order after failed/cancelled attempts |
| `src/navigation/AppNavigator.tsx` and `App.tsx` | Payment-status screen exists, but no DFCCIL payment-return handler | Add dedicated payment return handling, separate from SSO; restore correct session/payment screen after browser return or app restart |
| `src/screens/PaymentHistoryScreen.tsx` | Displays local payments and downloads/shares receipts | Display DFCCIL attempts/results and use official gateway receipt after verified success |
| `src/services/receiptService.ts` and `receiptPdf.ts` | Downloads remote PDFs, with fallback generation containing local name/email | Add authorized official DFCCIL PDF retrieval. Keep a local charging bill distinct from the gateway's privacy-preserving receipt; do not replace the official receipt with an invented fallback |
| `src/screens/ChargerDetailScreen.tsx`, `QRStartScreen.tsx`, `LiveSessionScreen.tsx` | Start charging without payment, then navigate to summary | Keep as the charging entry points for post-charge collection. Change here only if the client explicitly requires prepayment |
| `src/i18n/en.ts`, `hi.ts`, and `src/types/index.ts` | Offline/Razorpay wording and limited result types | Add online checkout, pending verification, cancellation, timeout, amount mismatch and retry states in both languages |

### Existing defects that matter for integration

- `paymentService.getSessionPayment()` calls `isPrepaidSession()`. A session with amount/time limits can therefore get `amountDue = 0` and a pending payment relabelled `paid`. This must not determine DFCCIL payment eligibility or success.
- `offlineCollectionStatusLabel()` labels any `paid`/`success` as Paid Offline. It needs the payment method/verification source.
- The summary generates an `RCP-...` display value even without an actual receipt. A bill reference must not be presented as a confirmed payment receipt.
- `hdfcPaymentService.ts` always throws, even when given a checkout URL. The sibling web HDFC adapter is also a placeholder; neither is an existing working DFCCIL integration.
- The `processRazorpaySessionPayment()` and `createRazorpaySessionPayment()` implementations remain in the service, but the active charging screens do not call them. The legacy payment-status screen is registered but no active charging navigation into it was found.
- `MOBILE_APP_FLOW_README.md` has an offline-flow update at the top but retains older prepaid descriptions later. Use the current call graph rather than treating all of that document as current requirements.

## Backend integration points

Reuse `server/sso/sessions.js` for authenticated create/status/receipt requests. `authenticate()` already checks the stored session, revocation, current role and user mapping.

**Identity detail:** in the EV-CMS application JWT, `claims.sub` is the internal `EV_Users.id`; `claims.virtualId` is the original DFCCIL SSO subject. Send **`auth.claims.virtualId`** as gateway `VirtualId`, not the internal user UUID. Do not accept VirtualId, AppId, bill amount or callback URL from the phone as authoritative.

Suggested new routes (proposals; not currently implemented):

| Route | Responsibility |
| --- | --- |
| `POST /api/payments/dfccil/create` | Authenticate, confirm bill ownership/finalization, calculate payable amount server-side, persist attempt, call SavePaymentData, save returned orderId/paymentUrl |
| `GET /api/payments/dfccil/return` | Exact registered public callback; correlate an existing order, record the browser result idempotently, perform trusted verification when available, and offer return to the mobile app |
| Authenticated status route | Return the stored authoritative status to the app; allow safe recovery after browser cancellation, duplicate callback or app restart |
| Authenticated receipt route | Confirm payment ownership and success; fetch the official PDF server-side from the fixed gateway host |

Place provider logic in a new `server/payments/dfccil.js` module. Reuse `api/mobile.js` authorization patterns or add explicit payment dispatch there; its current function allowlist accepts only the two Razorpay edge-function names. The local development runner in `scripts/sso-dev-server.mjs` currently serves only `/api/sso` and `/api/mobile` and must be extended if the proposed routes are used locally.

The callback must be public HTTPS because the gateway redirects the browser to it. It cannot require the mobile Bearer header. Protected order creation/status/receipt operations still require that header. A mobile deep link is a second leg after the registered HTTPS return, not a replacement for that Return URL. The existing `in.dfccil.evcms://auth/callback` remains exclusively the SSO callback.

The PDF documents only `orderId` and `txnStatus` as browser parameters. They are not signed payment evidence. Until an authenticated status API, signed callback or equivalent verification contract is supplied, record `CHARGED` as a reported result pending verification; do not grant paid status from user-controlled query parameters. An unguessable orderId or callback state prevents some correlation errors but does not authenticate txnStatus.

## Database and accounting

Reuse `EV_ChargingSessions`, `EV_Payments` and `EV_Receipts` as application records. Add a migration for a provider-specific attempt ledger or equivalent well-defined fields. At minimum track:

- Local user, session and payment IDs; server-calculated INR amount and bill snapshot.
- Gateway/AppId/NatureOfPaymentId snapshot, external orderId and validated checkout URL.
- A unique external orderId and per-bill attempt identity; multiple failed attempts must not become multiple paid bills.
- Raw provider status separately from normalized application status and verification state.
- Created/returned/verified timestamps, receipt reference and reconciliation result.

Use atomic/idempotent finalization. A verified successful payment cannot be downgraded by a later cancelled/failed browser return. Duplicate taps, concurrent create calls, network timeouts and repeated callbacks require explicit handling. Do not automatically retry a timed-out create request if it might already have created an external order.

`mobile/SESSION_RAZORPAY_PAYMENT.sql` has useful ownership/idempotency patterns, but its bind/complete functions explicitly set gateway='razorpay' and create local receipt URLs. Do not use them unchanged for DFCCIL. The sibling repository contains newer billing/migration variants; reconcile the deployed schema before writing a new migration. Local SQL files alone do not establish what is live.

## Deployment findings

The registered callback handler does not exist in this working tree. Root `vercel.json` targets a Vite web build, but root `src/` and `scripts/generate-fcm-web-config.mjs` are absent here. The complete web source is in the sibling reference project. `vercel.sso.json` provides an API-only deployment option, but does not prove which source/configuration serves the registered `ev-cms-rho.vercel.app` domain. Deploy the new route into the actual project serving that domain or arrange explicit routing to it; a local endpoint alone will not receive production callbacks.

Put fixed gateway configuration on the server (for example `DFCCIL_PAYMENT_BASE_URL`, `DFCCIL_PAYMENT_APP_ID`, `DFCCIL_NATURE_OF_PAYMENT_ID`, `DFCCIL_PAYMENT_RETURN_URL`). The app needs its own backend URL and safe provider/readiness information, not payment-provider credentials or an editable amount/VirtualId passed straight through.

## Recommended implementation order

1. Confirm post-charge collection versus prepayment, trusted verification and approved live-test procedure.
2. Implement server configuration, order-attempt persistence, authenticated create/status/receipt routes and the exact registered public return route.
3. Wire the completed-session bill to a DFCCIL browser checkout adapter, add mobile return/recovery handling, and remove the false paid/offline-only assumptions.
4. Add official receipt retrieval and history; update gateway types/config parsing and both language files.
5. Test forged/duplicate/out-of-order returns, ownership, duplicate orders, cancellations, timeouts, amount mismatch, receipt failure and app restart before a controlled approved live payment.

No existing merchant credential or native Razorpay SDK setup is a substitute for this work. The confirmed Base URL, AppId and registered Return URL are sufficient to prepare the provider integration; authoritative success verification and business timing still determine safe fulfillment behavior.
