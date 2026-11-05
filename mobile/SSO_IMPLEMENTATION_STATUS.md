> **DFCCIL confirmation received:** The registered mobile callback is `in.dfccil.evcms://auth/callback`. The previous `/sso/callback` was not registered and caused the authorization error. Client enabled; Authorization Code + PKCE S256; public mobile client with no secret. Authorization and token exchange now use the registered callback. Historical error details below describe the old request.

# SSO implementation status

Updated: 31 October 2026. This distinguishes implemented source from live deployment and provider validation. The last real DFCCIL authorization attempt failed on the provider before its login form; no successful end-to-end UAT login is claimed.

## Implemented without external provider changes

- System-browser Authorization Code + PKCE S256, state/nonce checks, `openid` scope and native callback.
- ID-token signature, issuer, audience, authorized-party and time checks on the backend. No client secret or service-role key enters the mobile bundle.
- Sessions persisted in the existing `EV_UserSessions` table with hashed tokens, JWT IDs and expiry. Stored-session lookup and current user status/mapping/role checks run on every protected request. The existing session schema was verified with a read-only database check.
- Device logout, logout of all EV-CMS devices, administrator revocation, expiry handling, and foreground revalidation. Offline logout queues revocation securely until the backend is reachable; it cannot revoke a remote record while disconnected.
- Authenticated data gateway for the mobile Supabase client: table/RPC allowlists, ownership predicates, safe nested selections, bounded reads, and explicit permitted mutations. Private user/password/session tables and arbitrary RPCs are not exposed.
- Server-controlled payment ownership and bill synchronization. Client claims of successful payment, amounts due or tariff snapshots cannot be written through the gateway. Legacy mock-payment and simulator mutations are intentionally unavailable in SSO mode.
- Authenticated charging proxy: user identity and MOBILE tag come from the verified session; admin bypass and arbitrary payment claims are not forwarded. Stop requires ownership of the matching active charger transaction. Server-side amount/time limit calculations use stored tariffs.
- Own-folder storage operations, short-lived signed URLs, upload size limits, and authenticated polling instead of anon realtime subscriptions.
- Administrator user-access screen under Profile, plus backend-only role/status/mapping changes and session revocation. Unknown subjects require administrator approval. Existing user IDs/history are preserved. No user rows were modified to test this.
- Optional provider logout code, activated only by its approved post-logout callback configuration.
- Deployment assets: API-only Vercel config; server-only environment template; shared-database lockdown SQL; OCPP authentication middleware; payment edge functions that reject direct anon calls.

## Checks

Run from the repository root:

```bash
npm run check:sso
```

This runs 50 backend security tests and the mobile TypeScript check; both passed. The updated Android JavaScript bundle loaded in the emulator, and an HTTP smoke test confirmed the restarted data API rejects unauthenticated requests. Tests use isolated fixtures for session/authorization behavior, not fabricated live DFCCIL logins. Live Supabase checks were read-only and confirmed the existing user mappings/session schema. Both protected payment edge functions also pass `deno check`; live execution still requires deployment and payment gateway configuration.

## Remaining external dependencies

| Dependency | What is needed | Prepared work |
| --- | --- | --- |
| DFCCIL authorization failure | Resolved configuration cause: the previous callback was unregistered. Live login is being retested with the confirmed callback | Mobile and backend updated to `in.dfccil.evcms://auth/callback`; PKCE/public-client settings confirmed |
| Production hosting | Hosting project/domain access and server environment variables | `vercel.sso.json`, `api/sso.env.example`, both API routes |
| Shared database cutover | Database administrator access and coordinated migration of sibling web/other direct clients | `SSO_BACKEND_LOCKDOWN.sql`; do not apply before the other clients are ready |
| OCPP gateway deployment | Gateway operator deploys `deployment/ocpp-auth.js` before remote-start/stop routes and configures the same random `OCPP_GATEWAY_API_KEY` on both servers | Mobile routes through the authenticated backend; commands fail closed until configured |
| Payment edge deployment | Supabase function deployment access and existing payment gateway secrets/configuration | Source in `supabase/functions`; backend checks ownership and edge functions require its server credentials |
| Provider-wide logout | Approved post-logout callback and provider behavior confirmation | Optional implementation via `SSO_POST_LOGOUT_REDIRECT_URI` |
| Refresh tokens | DFCCIL authorization for `offline_access`/refresh grant, rotation and revocation contract | Existing sessions deliberately expire and require reauthentication; no unauthorized scope is requested |
| Back-channel logout | Registered logout endpoint, supported logout-token claims/signature/session contract from DFCCIL | Cannot safely infer these from discovery support alone |
| Production SSO | Production issuer/client registration, approved callbacks and any required secret | Current issuer/client are UAT-only |

## Local run

```bash
# Repository root; uses server-only values in root .env
npm run dev:sso
```

```bash
# Another terminal
cd mobile
npm start -- --port 8084 --clear
```

The configured emulator URL is `http://10.0.2.2:3001/api/sso`. Development HTTP is allowed only for exact local hosts. Both `/api/sso` and `/api/mobile` run on port 3001. Production requires HTTPS. The signing key is persisted in root `.env`; keep it server-only and keep the production key stable across instances.

For an API-only Vercel deployment use `vercel --local-config vercel.sso.json` after selecting the intended hosting project and configuring environment values. No deployment was performed in this task.

## Shared backend cutover order

1. Deploy and verify the authenticated API routes in the intended environment.
2. Migrate every consumer of the shared Supabase data, including the sibling web application, to verified backend access. Its existing browser-only SSO validation and anon RPC calls are not sufficient for this cutover.
3. Deploy OCPP middleware and protected payment edge functions. Their old public endpoints must not remain usable for the same operations.
4. Apply the reviewed lockdown SQL with database administrator privileges, then confirm direct anon table/RPC/storage access is denied and authenticated application requests still work.
5. Perform real UAT user/admin login, session revocation, cross-user access, upload, charging and payment tests after DFCCIL accepts authorization requests.

Do not treat local source checks or a login-screen screenshot as completion of these live deployment checks.

## Corrected callback verification

After applying DFCCIL’s confirmed `in.dfccil.evcms://auth/callback`, a live Authorization Code + PKCE S256 request returned HTTP 302 to `/Account/Login`, replacing the previous `/Home/Error` redirect. Both authorize and token exchange receive the same configured URI. All 50 backend tests and mobile TypeScript checks passed. Successful credential login/token exchange still needs to be verified. DFCCIL confirmed that `openid`, `profile`, `email`, `roles`, and `api1` are allowed for this client; the app continues to request only `openid` and does not assume additional profile claims.
