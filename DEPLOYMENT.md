# Deploy the dashboard and mobile backend

This repository contains the restored web dashboard and the mobile SSO/payment API. Deploy the repository root with `vercel.json`; do not use the older API-only `vercel.sso.json` for the dashboard project.

## Before deploying

1. In Vercel, keep the existing project/domain `ev-cms-rho.vercel.app`, set Root Directory to the repository root, framework Vite, Node.js 22.x, build command `npm run build`, output `dist`, install `npm ci`.
2. Preserve existing environment settings. Use `.env.example` as the required configuration reference. Set both Supabase URL variables and their respective public/service keys. Generate a stable random `SSO_SESSION_SECRET` of at least 32 bytes, for example `openssl rand -hex 32`. Keep service keys and session secrets backend-only. Add existing Firebase and email configuration if those features are used.
3. Set `DFCCIL_PAYMENTS_ENABLED=false`, `VITE_PAYMENT_GATEWAY_MOCK=false`, and `VITE_ENABLE_SIMULATION=false`. The documented Status API and atomic finalization are implemented. Keep collection disabled during deployment verification; enable it only for the approved controlled real-payment test after the steps below.
4. Run `npm ci`, then `npm run check:deployment` locally. Mobile dependencies must also be installed (`cd mobile && npm ci`). This checks web lint/types/build, mobile types, backend tests, API imports and routing configuration.
5. Back up the database and apply `supabase/migrations/20261104_dfccil_payment_attempts.sql`, then `supabase/migrations/20261104_dfccil_payment_verification.sql` to the existing database. These add a private ledger, a cross-instance 30-second status-check lease, and atomic service-only finalization functions. Do not replay old seed migrations or run the database setup script against the working database.

## Publish and verify

Use the existing Vercel project through the CLI steps below. If you use a connected Git checkout instead, push to its deployment branch. Verify the deployment build succeeds before promoting it to production. No hosting deployment or database migration is performed by the local checks.

- Open the dashboard and refresh a nested page; confirm the dashboard and web SSO callback still load.
- Confirm unauthenticated POST `/api/payments/dfccil/config` returns 401, rather than dashboard HTML. GET of the registered payment return URL without parameters should return an error page, not a success receipt.
- Sign in through mobile SSO and confirm the payment configuration reports disabled. Do not create real payment orders during this check.
- Mobile `preview` and `production` EAS builds point to the hosted `/api/sso`; the local `.env` remains usable for emulator development. Install the new mobile build and test sign-in, session restore and logout against the deployed backend.

## Verification and controlled live test

The complete HTML guide documents `GET https://epay.dfccil.com/Payment/Status/{orderId}`. The backend now verifies order ID, App ID, amount and consistent SUCCESS/CHARGED before atomically marking the payment and session paid. Unsigned browser returns never mark a bill paid. Checks run on authenticated mobile status requests and are rate-limited across instances to once per order per 30 seconds. The create request sends the documented string `NatureOfPaymentId: "30"`. Failed/cancelled outcomes can allow a fresh order only after server verification; amount mismatches remain blocked for reconciliation. A failed transaction PDF is never treated as payment proof. Mobile remote charging commands also require the protected OCPP gateway deployment and matching backend key.

Deployment checks passed after a clean root `npm ci`: web lint, web and mobile TypeScript, 103 backend tests, production web build, all 12 API handler imports, unauthenticated payment endpoint rejection, and routing configuration assertions. The build reports a non-blocking web-push chunking warning and an outdated Browserslist data notice. Cloud/native release builds and hosted end-to-end verification still need to run in their configured environments.

The restored web dashboard retains its existing direct Supabase access. Do not apply `mobile/SSO_BACKEND_LOCKDOWN.sql` until web access has been migrated and tested with the protected backend; it can break the existing dashboard. These local checks establish build readiness, not a security audit or a completed live payment test.

After deployment smoke checks pass, agree the real test amount and payer, set `DFCCIL_PAYMENTS_ENABLED=true` on the backend and redeploy. Use an owned, finalized charging bill with that approved amount. Verify success updates the payment and session exactly once and permits the official PDF receipt; verify cancellation/failure and an app restart can be recovered through status refresh. The first refresh may return a cached result; wait at least 30 seconds. No live payment has been created by local tests. Keep collection disabled for general use until this hosted test passes. Disable new order creation again if the controlled test fails; existing orders can still be checked while disabled.

## Complete steps to update the existing server

Deploy this folder to the existing Vercel project to update the dashboard and `/api` backend together. At the time of checking, this folder has no Git repository configured, so the CLI workflow below does not require a Git push. A working older mobile API does not establish that the new payment routes are deployed.

### 1. Find the existing Vercel project

Sign in to Vercel and open the project serving `ev-cms-rho.vercel.app`. Note its project name and account/team. Select this existing project when linking the local folder.

### 2. Check build settings

| Setting | Value |
| --- | --- |
| Root directory | Repository root |
| Framework | Vite |
| Node.js | 22.x |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |

Use root `vercel.json` for this deployment.

### 3. Configure environment variables

Preserve existing settings. Use [.env.example](.env.example) as the checklist and add missing variables for Production and Preview:

```dotenv
SUPABASE_URL=<existing Supabase project URL>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
SSO_SESSION_SECRET=<stable random secret>
SSO_ALLOWED_REDIRECT_URIS=in.dfccil.evcms://auth/callback
SSO_TOKEN_AUTH_METHOD=none

DFCCIL_PAYMENTS_ENABLED=false
DFCCIL_PAYMENT_BASE_URL=https://epay.dfccil.com
DFCCIL_PAYMENT_APP_ID=EV001
DFCCIL_NATURE_OF_PAYMENT_ID=30
DFCCIL_PAYMENT_RETURN_URL=https://ev-cms-rho.vercel.app/api/payments/dfccil/return

VITE_PAYMENT_GATEWAY_MOCK=false
VITE_ENABLE_SIMULATION=false
```

Replace placeholders with actual values. Keep an existing stable `SSO_SESSION_SECRET`; otherwise generate one with:

```bash
openssl rand -hex 32
```

Retain `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, Firebase and email settings. Service-role keys and session secrets must remain backend-only, without `VITE_` or `EXPO_PUBLIC_` prefixes. Changing local `.env` does not update Vercel environment settings.

### 4. Apply the database migrations

Back up the existing Supabase database. In Supabase → SQL Editor, run the payment-attempts migration first, then the payment-verification migration, using the actual filenames in `supabase/migrations/` listed above. If the first migration has already been applied successfully, apply the second.

Do not run database setup, old seed files, or `mobile/SSO_BACKEND_LOCKDOWN.sql` for this update.

### 5. Run local checks

```bash
cd /Users/utkarsh/workspace/LV/EV-CMS-main
npm ci
npm --prefix mobile ci
npm run check:deployment
```

Continue when checks pass.

### 6. Link to the existing project

```bash
npx vercel@latest login
npx vercel@latest link
```

Select the correct account/team, choose to link to an existing project, and select the project serving `ev-cms-rho.vercel.app`. See [Vercel project linking](https://vercel.com/docs/cli/link).

### 7. Deploy and check a preview

```bash
npx vercel@latest deploy
```

Open the resulting preview URL and confirm the dashboard loads. Replace `YOUR-PREVIEW-URL` below with its hostname:

```bash
curl -i -X POST \
  "https://YOUR-PREVIEW-URL/api/payments/dfccil/config" \
  -H "Content-Type: application/json" \
  -d '{}'
```

The application should return HTTP 401 without a login token, rather than dashboard HTML. If Vercel deployment protection intercepts the preview request, authenticate through Vercel before checking the application response. Do not initiate real payments on the preview; the registered payment return URL targets production.

### 8. Update production

From the repository root, run:

```bash
npx vercel@latest deploy --prod
```

This publishes the updated code to the linked project's production domain. See [Vercel deployment commands](https://vercel.com/docs/cli/deploy).

Confirm the dashboard loads, nested pages survive refresh, and existing web SSO still works. Repeat the unauthenticated API check against `https://ev-cms-rho.vercel.app`; it should return HTTP 401. The registered payment return URL without parameters should display an error page, not a success receipt.

### 9. Connect the mobile app to production

Set this value in `mobile/.env`:

```dotenv
EXPO_PUBLIC_SSO_BACKEND_URL=https://ev-cms-rho.vercel.app/api/sso
```

Restart Metro:

```bash
cd /Users/utkarsh/workspace/LV/EV-CMS-main/mobile
npm start -- --clear
```

Open the emulator app and verify sign-in, session history, session restore and logout against the hosted backend. Payments remain disabled. A distributed mobile app needs a new release build to receive updated mobile code/configuration; a backend deployment alone does not update an installed app bundle.

### 10. Enable the controlled real-payment test

Agree on the test payer and small real amount. Change only the Vercel Production setting to `DFCCIL_PAYMENTS_ENABLED=true`, then deploy again from the repository root:

```bash
cd /Users/utkarsh/workspace/LV/EV-CMS-main
npx vercel@latest deploy --prod
```

Pay an owned, completed charging bill with the agreed amount through the mobile UI. Confirm it becomes Paid and the official receipt downloads. Allow at least 30 seconds between gateway status checks. Also verify cancellation/failure and app restart recovery before general rollout.

### Rollback

If the code deployment causes problems, restore the previous production deployment through Vercel. Keep the additive database migrations in place. If payment testing fails, disable new orders with `DFCCIL_PAYMENTS_ENABLED=false` and redeploy; existing orders can still be checked and reconciled.
