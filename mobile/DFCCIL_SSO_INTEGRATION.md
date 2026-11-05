# DFCCIL SSO integration findings

Recorded: 31 October 2026. Environment: UAT.

This document combines the integration details supplied by DFCCIL, the public discovery document fetched during investigation, and observations from the current mobile code. Initial SSO implementation is present and enabled for local Android UAT. A live authorization attempt reached DFCCIL but returned the provider's error page before credential entry; end-to-end login is not confirmed.

## Implementation and UAT setup

Implemented components:

- Mobile system-browser Authorization Code + PKCE S256, state checking through Expo AuthSession, and per-login nonce.
- Proposed native callback: `in.dfccil.evcms://sso/callback`. This is a requested registration value, not a confirmed DFCCIL registration.
- `api/sso.js`: backend code exchange, RS256 ID-token verification through provider JWKS, issuer/audience/time/nonce checks, explicit active-user mapping, and signed application sessions.
- `mobile/SSO_IDENTITY_MAPPING.sql`: non-destructive schema reference for the existing `EV_Users.sso_sub` mapping; no automatic user or admin creation.
- Native secure storage for SSO sessions; stored session revocation and current-role lookup on every protected backend request.
- A conditional Sign in with DFCCIL button; existing password login remains available.

To configure UAT:

1. Ask DFCCIL to register the proposed callback and confirm token endpoint authentication. Configure `SSO_TOKEN_AUTH_METHOD` explicitly; use `none` only if confirmed. A confidential client secret stays on the backend.
2. Check existing `EV_Users.sso_sub` mappings before changing the database. All three supplied UAT users were confirmed active with their expected roles in the connected database. No migration is needed for this UAT instance. For a new database, review `mobile/SSO_IDENTITY_MAPPING.sql` and explicitly map existing users; roles remain in `EV_Users`.
3. Deploy both Vercel-compatible `api/sso.js` and `api/mobile.js` endpoints with the server variables listed in `api/sso.env.example`. Do not put service-role keys or session-signing secrets in mobile environment variables.
4. Set `EXPO_PUBLIC_SSO_BACKEND_URL=https://<your-host>/api/sso`, `EXPO_PUBLIC_SSO_REDIRECT_URI=in.dfccil.evcms://sso/callback`, and `EXPO_PUBLIC_SSO_ENABLED=true` in `mobile/.env`.
5. Regenerate the native project with `npx expo prebuild --platform android` from `mobile` and rebuild with `npm run android`. For iOS use the corresponding prebuild/build commands. Native callback and secure-storage changes require a new binary.
6. Test browser cancellation, successful UAT login, unmapped/inactive users, callback errors, restoration, expiry, and local logout. Run backend token-validation tests with `node --test tests/sso.test.js` from the repository root.

### Current implementation and deployment boundaries

SSO data requests now pass through `api/mobile.js`, which authenticates a stored `EV_UserSessions` record, checks revocation/expiry and the current user mapping/role, and enforces ownership. Direct financial mutations and arbitrary RPCs/relations are denied. Storage is restricted to the current user's folder, with five-minute signed downloads and a 2 MB upload limit. Realtime subscriptions use authenticated polling in SSO mode.

Logout revokes the server record; logout-all revokes every session for the current user. Offline logout clears the device and queues revocation in secure storage for retry. Administrators can provision accounts, change mappings/roles/status, and revoke sessions through Profile → Manage SSO user access. Unknown users require explicit administrator provisioning; no automatic email matching or admin assignment occurs.

**These routes do not remove existing direct Supabase access by themselves.** `SSO_BACKEND_LOCKDOWN.sql` removes legacy anon/authenticated privileges and makes `ev-media` private. It requires a coordinated cutover of the sibling web app and other clients, plus database administrator access. It has not been applied to the shared database. Existing public storage URLs remain public until that deployment change is made.

The OCPP proxy refuses to issue charging commands until the gateway's bearer-auth middleware and server key are deployed. Payment edge-function source now requires backend credentials before trusting X-User-Id; its deployment is also required to close direct-call bypasses. Neither remote service was modified live.

Application sessions are capped at one hour and the ID token expiry. No refresh token is requested without DFCCIL approval. Provider logout support is implemented but activates only when the registered `SSO_POST_LOGOUT_REDIRECT_URI` is configured; local EV-CMS revocation does not depend on it. No back-channel logout receiver is implemented because DFCCIL's client registration/session logout contract has not been supplied.

See `SSO_IMPLEMENTATION_STATUS.md` for exact completed work, checks and external dependencies.

## Configuration supplied by DFCCIL

| Setting | Value |
| --- | --- |
| Protocol | OpenID Connect |
| Login flow | Authorization Code with PKCE |
| Authority / issuer | `https://app2.dfccil.com` |
| Discovery document | `https://app2.dfccil.com/.well-known/openid-configuration` |
| EV-CMS Client ID | `f51c3d26cd09487eb2350a9742b8af18` |
| Approved scope | `openid` |

## Verified public discovery metadata

Source: [DFCCIL OpenID configuration](https://app2.dfccil.com/.well-known/openid-configuration), fetched on 31 October 2026.

| Setting | Published value |
| --- | --- |
| Issuer | `https://app2.dfccil.com` |
| Authorization endpoint | `https://app2.dfccil.com/connect/authorize` |
| Token endpoint | `https://app2.dfccil.com/connect/token` |
| Userinfo endpoint | `https://app2.dfccil.com/connect/userinfo` |
| Signing keys (JWKS) | `https://app2.dfccil.com/.well-known/openid-configuration/jwks` |
| Logout endpoint | `https://app2.dfccil.com/connect/endsession` |
| Session-check iframe | `https://app2.dfccil.com/connect/checksession` |
| Token revocation | `https://app2.dfccil.com/connect/revocation` |
| Token introspection | `https://app2.dfccil.com/connect/introspect` |
| Device authorization | `https://app2.dfccil.com/connect/deviceauthorization` |
| PKCE challenge methods | `plain`, `S256` — use `S256` |
| ID-token signing algorithm | `RS256` |
| Token endpoint authentication methods | `client_secret_basic`, `client_secret_post` |
| Subject types | `public` |
| Response modes | `form_post`, `query`, `fragment` |

The provider advertises the following grant types:

- `authorization_code`
- `client_credentials`
- `refresh_token`
- `implicit`
- `urn:ietf:params:oauth:grant-type:device_code`

It advertises response types `code`, `token`, `id_token`, `id_token token`, `code id_token`, `code token`, and `code id_token token`. EV-CMS should use the agreed Authorization Code flow with PKCE, rather than choosing another advertised flow.

Front-channel and back-channel logout, including session support, are advertised. Request parameters are supported.

### Server-wide scopes and claims

Advertised scopes: `openid`, `profile`, `email`, `roles`, `api1`, `sso.virtualid.resolve`, `offline_access`.

Advertised claims: `sub`, `name`, `family_name`, `given_name`, `middle_name`, `preferred_username`, `profile`, `picture`, `website`, `gender`, `birthdate`, `zoneinfo`, `locale`, `updated_at`, `email`, `email_verified`, `role`.

These describe provider capabilities, not permissions granted to this Client ID. The supplied EV-CMS agreement allows only `openid` and states that profile information and roles will not be shared. Refresh-token support and `offline_access` availability for EV-CMS remain unconfirmed. The advertised `sso.virtualid.resolve` scope does not establish that EV-CMS can use it or reveal how its API works.

## Identity and Virtual ID

### MyDFC account login

The [DFCCIL account page](https://app2.dfccil.com/Account/Login) offers employee-ID login and **Scan to Login** using the MyDFC mobile app. Its instructions say to scan the displayed QR code in MyDFC and approve or reject the request. This is provider-side account authentication, not EV-CMS account provisioning or a charging QR code.

Opening the account URL directly can report that `returnUrl` is required. The mobile app must initiate `/connect/authorize` with its OIDC parameters and allow DFCCIL to choose the login/approval page, preserving the authorization transaction. Do not replace the authorization endpoint with a hardcoded `/Account/Login` URL. Which UAT accounts support MyDFC approval, and the exact password/OTP/QR requirements, remain provider-controlled.

According to DFCCIL's supplied integration details:

- The user's Virtual ID is returned in `sub` in the ID token, access token, and userinfo response.
- It is a lowercase GUID, stable across EV-CMS logins and unique to EV-CMS.
- No employee code, name, email, mobile number, or role is supplied.
- Other token claims may include `iss`, `aud`, `client_id`, `exp`, `iat`, `nbf`, `auth_time`, `idp`, `amr`, and `sid`. Do not assume every claim appears in every token type.

Use the verified issuer and `sub` together as the external identity mapping. Preserve the existing EV-CMS user record ID so charging history, transactions, RFID associations, and other records remain linked.

The discovery document declares subject type `public`; the supplied agreement describes the Virtual ID as unique to EV-CMS. Confirm the intended cross-client identity behavior with DFCCIL before relying on it outside this application.

## UAT account mappings supplied by DFCCIL

| Intended role in EV-CMS | SSO username / employee code | Virtual ID (`sub`) |
| --- | --- | --- |
| Admin | `102199` | `49b29e77-5a32-4816-a842-882a92e57e55` |
| Admin | `900025` | `a36f76cb-cef6-4b7b-9053-d5a54ab11dfd` |
| User | `900034` | `cdab677d-fa11-480b-baf7-6806ade66186` |

Passwords are omitted from this repository document. Obtain the UAT credentials through the existing approved channel. Enter them only on DFCCIL's login page, not the current EV-CMS email/password form.

Roles are managed and enforced by EV-CMS, not supplied by SSO. Provision the two admin mappings in the backend rather than trusting a role or Virtual ID submitted by the mobile client.

## Current mobile application

- `src/services/authService.ts` authenticates email/password through the Supabase `verify_ev_login` RPC.
- `src/context/AuthContext.tsx` manages the current user and login state.
- This flow is separate from DFCCIL SSO; the SSO UAT accounts cannot be used in the existing email/password form.
- The documented demo credentials returned no matching user from the configured backend during investigation. That result does not establish whether the user is absent or the password differs.

## Proposed integration

1. Add a **Sign in with DFCCIL** action using Expo AuthSession and a system-browser authentication session.
2. Discover the endpoints and start Authorization Code flow with PKCE `S256`, state, and nonce, requesting the approved `openid` scope.
3. Receive the authorization response at a registered mobile callback. Validate state and exchange the code according to the confirmed client configuration.
4. Have the EV-CMS backend establish trust in the identity using an OIDC library. Validate the signature using JWKS, exact issuer, expected audience, expiry and other applicable time claims, and the nonce bound to the login transaction. Do not treat decoding a JWT as validation.
5. Map the verified issuer and `sub` to a provisioned EV-CMS user and load the locally assigned role.
6. Establish an EV-CMS application session and enforce authorization on subsequent backend requests. Integrate this session with Supabase access controls; a DFCCIL token is not automatically accepted by Supabase.
7. Implement secure session storage, expiry handling, and logout, including provider logout where appropriate.

If DFCCIL requires a confidential client secret, perform the relevant token exchange on an EV-CMS backend. Never embed a client secret in the mobile application. The exact design depends on confirmation of the registered client type.

Existing accounts require explicit administrator mapping because the SSO response contains no email or employee code. The implemented enrollment policy is administrator approval; unknown Virtual IDs are denied until provisioned.

## Information still required

- Registered Android and iOS redirect URLs; web redirect URLs if web SSO is also needed.
- Confirmation that this Client ID is a public native client supporting PKCE `S256` with no client secret, or details of the required backend exchange.
- Approved post-logout redirect URLs and logout parameters/behavior.
- Token lifetimes, refresh-token permission, rotation/revocation policy, and session renewal expectations.
- Administrator-supplied name/email and verified Virtual IDs for any new accounts; the approval workflow is implemented.
- EV-CMS deployment cutover of legacy Supabase privileges after all clients use the authenticated backend.
- Any UAT network restrictions and the separate production issuer/client configuration.

The discovery document advertises only `client_secret_basic` and `client_secret_post` for token endpoint authentication; it does not advertise `none`. This is a reason to confirm native-client support, not proof that this specific client requires a secret. Discovery does not disclose client-specific redirect URLs or permissions.

Suggested question to DFCCIL:

> Is Client ID `f51c3d26cd09487eb2350a9742b8af18` configured as a public mobile client using Authorization Code flow with PKCE S256 and no client secret? Which Android/iOS redirect and post-logout URLs are registered, and are refresh tokens permitted?

## Scope boundary

Payment gateway requirements will be addressed separately, as stated in DFCCIL's supplied notes. Token validation has automated tests, and a real UAT authorization request has been attempted. No successful UAT token exchange or account login has occurred.

## Local Android UAT run

The callback `in.dfccil.evcms://sso/callback` is treated as registered at the user’s instruction. Token exchange uses public-client PKCE (`none`) as a UAT assumption matching the existing web implementation; actual acceptance must be verified with DFCCIL.

The backend now reads `EV_Users.sso_sub` directly with server-only credentials. A read-only database check confirmed the three supplied Virtual IDs are present, active, and assigned User/SuperAdmin as expected. Do not run the sibling source’s seed migration to repeat setup: it contains deletions of other users and transaction data.

Start the local backend from the repository root:

```bash
node scripts/sso-dev-server.mjs
```

Start Metro from another terminal:

```bash
cd mobile
npm start -- --port 8084 --clear
```

The local mobile configuration uses `EXPO_PUBLIC_SSO_ENABLED=true` and `EXPO_PUBLIC_SSO_BACKEND_URL=http://10.0.2.2:3001/api/sso`. HTTP is permitted only in development builds for the exact local hosts `10.0.2.2`, `127.0.0.1`, and `localhost`; production still requires HTTPS. The backend binds to the Mac loopback address, uses existing root `.env` server credentials, and loads a persistent signing key from the server-only root `.env`, generating and saving one there on the first run. Sessions are validated against the existing database session table and survive server restarts until expiry or revocation.

Open the installed Android development build against Metro port 8084, then tap **Sign in with DFCCIL**. Use the UAT employee credentials on DFCCIL’s browser page. Success must include returning to the app, completing token validation, matching the existing local user, and reaching the dashboard. Reaching the provider login page alone does not prove the callback/token exchange works.

### Live UAT authorization result

The emulator's Sign in with DFCCIL button successfully opened a system-browser authorization request to the real provider. DFCCIL displayed **Error — An error occurred while processing your request**, before any credentials were entered.

Provider request ID displayed in the browser:

```text
00-dbe72d4a15b193746288d988f0811e8f-bfc6d9eb0d3fd818-00
```

An independent live request using the same Client ID, `openid` scope, callback, Authorization Code response type and PKCE S256 returned HTTP 302 to `https://app2.dfccil.com/Home/Error?errorId=...`. The opaque error identifier is omitted here. This confirms the error occurs at authorization, before the local backend is involved. The public error page does not identify the underlying reason; callback/client registration or another provider-side issue must be checked in DFCCIL logs rather than inferred.

Send DFCCIL the request ID and ask them to check `/connect/authorize` for this Client ID and the exact callback `in.dfccil.evcms://sso/callback`. Do not enable the provider's development mode on a deployed server merely because its generic error page suggests it.

## Corrected callback verification

After applying DFCCIL’s confirmed `in.dfccil.evcms://auth/callback`, a live Authorization Code + PKCE S256 request returned HTTP 302 to `/Account/Login`, replacing the previous `/Home/Error` redirect. Both authorize and token exchange receive the same configured URI. All 50 backend tests and mobile TypeScript checks passed. Successful credential login/token exchange still needs to be verified. DFCCIL confirmed that `openid`, `profile`, `email`, `roles`, and `api1` are allowed for this client; the app continues to request only `openid` and does not assume additional profile claims.
