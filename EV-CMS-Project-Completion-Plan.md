# EV-CMS Project Completion Plan

**Project:** DFCCIL EV Charger Management System (EV-CMS)  
**Repository:** `EV-CMS-Project`  
**Last reviewed:** June 2026  
**Current branch:** `Jatindev` (synced with `main` @ `efe7d3f`)

---

## 1. Executive summary

| Area | UAT / demo readiness | Production readiness | Notes |
|------|----------------------|----------------------|-------|
| **Web admin** | ~90% | ~70% | Full Supabase-backed CMS; payments are read-only by design |
| **Mobile app** | ~85% | ~55% | End-user flows complete; infra wiring (OCPP, FCM, Maps, Razorpay secrets) pending |
| **OCPP gateway** | ~60% | ~40% | Phase 1 REST + WS implemented; not lab-validated or TLS-deployed |
| **Supabase backend** | ~85% | ~65% | Schema + RPCs rich; RLS is permissive for anon (UAT); tighten for prod |
| **Notifications** | ~75% | ~50% | In-app + DB triggers done; mobile push delivery partially wired |
| **Payments / billing** | ~80% | ~60% | Wallet + Razorpay on mobile; web is history-only; SBIePay/simulator in data |

**Overall project estimate:** ~**78% feature-complete** for DFCCIL UAT demonstration; ~**58% production-hardened** (security, real chargers, live gateways, push, monitoring).

### Design decisions (confirmed)

- **Razorpay** — mobile app only (wallet top-up). Web admin does **not** process payments.
- **Web payments** — read-only: session billing history, wallet top-up orders, per-user balances, receipt download (HTML / print-to-PDF).
- **Charging in dev/UAT** — simulator RPCs (`ev_sim_*`) when no physical OCPP connection; OCPP gateway available for real hardware.
- **Auth** — custom email/password via Supabase RPCs (`verify_ev_login`), **not** Supabase Auth. Web uses `localStorage`; mobile uses `AsyncStorage`.

---

## 2. System architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────────┐
│  Web admin      │     │  Mobile app      │     │  OCPP gateway           │
│  React + Vite   │     │  Expo 52         │     │  Node.js WS + REST      │
│  Port 3000      │     │  iOS / Android   │     │  Port 4040              │
└────────┬────────┘     └────────┬─────────┘     └────────────┬────────────┘
         │                       │                              │
         │    anon key + RPCs    │    anon key + RPCs           │ service role
         └───────────────────────┴──────────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  Supabase (Postgres)    │
                    │  RLS, triggers, realtime│
                    │  Edge Functions (3)     │
                    └────────────┬────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
     Power Automate        Razorpay API        Expo Push API
     (email)              (wallet top-up)     (mobile push)
```

**Edge functions (Supabase):**

| Function | Purpose | Called from |
|----------|---------|-------------|
| `ev-cms-mobile-wallet-create-razorpay-order` | Create Razorpay order | Mobile |
| `ev-cms-mobile-wallet-verify-razorpay-payment` | Verify payment, credit wallet | Mobile |
| `send-push-notification` | Deliver push via Expo Push API | Backend (not fully wired to triggers) |

---

## 3. Web admin — module status

**Stack:** React 18, Vite, TypeScript, Tailwind, Supabase JS, Recharts, i18next (scaffold only).

### 3.1 Routes & access

| Route | Module | Roles | Status |
|-------|--------|-------|--------|
| `/login` | Auth | Public | ✅ Done |
| `/dashboard` | Dashboard | SuperAdmin, SiteAdmin | ✅ Done |
| `/chargers` | Charger list | Both | ✅ Done |
| `/chargers/:id` | Charger detail + OCPP commands | Both | ✅ Done (needs gateway URL) |
| `/sessions` | Active + history sessions | Both | ✅ Done |
| `/users` | User CRUD + wallet column | Both | ✅ Done |
| `/rfid` | RFID cards | Both | ✅ Done |
| `/tariffs` | Tariff CRUD | SuperAdmin only | ✅ Done |
| `/payments` | Payments & Wallets (3 tabs) | Both | ✅ Done (read-only) |
| `/payments/:id` | Payment detail + receipt | Both | ✅ Done |
| `/support-tickets` | Support tickets | Both | ✅ Done |
| `/reports` | Reports + export | SuperAdmin only | ✅ Done |
| `/audit-logs` | Audit log viewer | SuperAdmin only | ⚠️ Read-only (no client writes) |
| `/settings` | Profile, security, prefs | Both | ✅ Done |
| `/simulator` | Charger simulator | SuperAdmin (+ flag) | ✅ Done (dev/UAT) |
| `/notifications` | In-app notifications | Both | ✅ Done (bell entry; not in sidebar) |

### 3.2 Feature checklist

| Feature | Status | Details |
|---------|--------|---------|
| Login / logout / session timeout | ✅ | `verify_ev_login` RPC; demo credentials on login page (remove for prod) |
| Role-based route guards | ✅ | SuperAdmin vs SiteAdmin (`rfpRoles.ts`) |
| Dashboard live stats + charts | ✅ | Realtime + auto-refresh |
| Charger CRUD + bulk CSV import | ✅ | |
| Connector status + event log | ✅ | |
| OCPP remote start/stop/reset/unlock/firmware/config | ⚠️ | Requires `VITE_OCPP_GATEWAY_API_URL` |
| Session list + remote stop | ✅ | |
| Session detail page (`/sessions/:id`) | ❌ | Not implemented |
| User management + welcome emails | ✅ | Power Automate proxy |
| RFID bind/unbind | ✅ | |
| Tariff management | ✅ | |
| **Session payments (read-only)** | ✅ | User names via `list_ev_users` lookup |
| **Wallet top-ups (read-only)** | ✅ | Razorpay orders from mobile |
| **User wallets + ledger drawer** | ✅ | Fixed anon RLS join issue |
| Receipt download (HTML) | ✅ | All successful payments; avoids stub PDF URLs |
| Support tickets + attachments | ✅ | |
| Reports CSV / print | ✅ | |
| Audit logs | ⚠️ | View only; populated by DB/backend |
| Settings (avatar, OTP email, prefs) | ✅ | |
| In-app notifications | ✅ | Phase 1 + 2 operational alerts (DB triggers) |
| Admin operational alert emails | ✅ | `operationalAlertService` + Power Automate |
| Global search | ✅ | Chargers, sessions, users |
| i18n UI strings | ❌ | Library wired; pages are English-only |
| Firebase analytics | ⚠️ | Optional via env |
| Web payment processing | ❌ | Intentionally excluded (mobile only) |
| Web Razorpay | ❌ | Intentionally excluded |

### 3.3 Web — remaining work

| Priority | Item | Effort |
|----------|------|--------|
| P1 | Remove demo login pre-fill before production | S |
| P1 | Deploy OCPP gateway + set `VITE_OCPP_GATEWAY_API_URL` | M |
| P2 | Session detail route `/sessions/:id` | M |
| P2 | Production RLS (replace broad anon policies) | L |
| P2 | Migrate auth to Supabase Auth or signed JWT for RLS | L |
| P3 | i18n for Hindi (match mobile) | M |
| P3 | Audit log emission from web actions (or document DB-only) | M |
| P3 | Pagination on large tables (payments, sessions, audit) | S |
| P4 | Remove dead code (`pages/home`, `PlaceholderPage`) | S |

---

## 4. Mobile app — module status

**Stack:** Expo 52, React Native 0.76, React Navigation 7, Supabase JS, Razorpay native SDK.

### 4.1 Screens (19)

| Screen | Status | Notes |
|--------|--------|-------|
| Login | ✅ | Custom auth, en/hi |
| Home | ✅ | Stats, recent sessions, realtime |
| Charger list | ✅ | Filters, online/offline |
| Nearest map | ⚠️ | List + GPS works; **map tiles need Google Maps API key** |
| Charger detail | ✅ | Start charging (User role only) |
| QR start | ✅ | `expo-camera` native; manual input on web |
| Live session | ✅ | Poll + realtime |
| Session summary | ✅ | Pay from wallet, receipt, top-up redirect |
| Session history | ✅ | |
| Payment history | ✅ | Receipt PDF download/share (`pdf-lib`) |
| Wallet | ✅ | Balance, holds, ledger |
| Top-up (Razorpay) | ⚠️ | Needs EAS dev build + edge function secrets |
| Top-up status | ✅ | Poll order status |
| Wallet transactions | ✅ | |
| RFID binding | ✅ | Optional for mobile auth |
| Profile | ✅ | Avatar upload to `ev-media` |
| Support (create) | ✅ | Up to 5 image attachments |
| Support tickets list | ✅ | |
| Support ticket detail | ⚠️ | Read-only (no reply thread) |
| Notifications | ✅ | In-app list + deep links |

### 4.2 Mobile — role model

| Role | Mobile access |
|------|---------------|
| **User** | Full charging, wallet, RFID, QR, payments |
| **SiteAdmin / SuperAdmin** | Monitoring only (chargers, map, history, profile, support); no wallet/QR |

### 4.3 Mobile — feature checklist

| Feature | Status | Details |
|---------|--------|---------|
| Custom auth + session persistence | ✅ | 8h token in AsyncStorage |
| i18n (English + Hindi) | ✅ | |
| Charger discovery + QR start | ✅ | |
| Simulated charging (`ev_sim_*`) | ✅ | Default UAT path |
| Real OCPP remote start/stop | ❌ | `EXPO_PUBLIC_OCPP_GATEWAY_API_URL` unused in code |
| Wallet balance + session debit | ✅ | `ev_pay_session_from_wallet` |
| Razorpay wallet top-up | ⚠️ | Code complete; needs EAS build + `RAZORPAY_*` secrets |
| Mock top-up fallback | ✅ | When gateway not configured |
| Receipt PDF (on-device) | ✅ | `receiptPdf.ts` + server URL fallback |
| Push token registration | ✅ | `EV_UserPushTokens` on login |
| Push delivery (server) | ❌ | `send-push-notification` not triggered from DB |
| In-app notifications | ✅ | `EV_Notifications` + realtime |
| Support tickets | ⚠️ | Create + list; detail is read-only |
| Maps | ⚠️ | Empty `googleMaps.apiKey` in `app.json` |
| FCM / `google-services.json` | ❌ | Not in repo; required for Android push prod |

### 4.4 Mobile — remaining work

| Priority | Item | Effort |
|----------|------|--------|
| P1 | Run `mobile/SUPABASE_MOBILE_POLICIES.sql` on Supabase | S |
| P1 | Run `mobile/CUSTOM_PUSH_NOTIFICATIONS.sql` | S |
| P1 | EAS build + Razorpay secrets on Supabase | M |
| P1 | Add Google Maps API key to `app.json` | S |
| P2 | `google-services.json` + FCM V1 in EAS | M |
| P2 | Wire `send-push-notification` to DB triggers / cron | M |
| P2 | Integrate OCPP gateway for real charger start/stop | L |
| P3 | Support ticket replies in-app | M |
| P3 | Top-up status when `EXPO_PUBLIC_API_BASE_URL` empty | S |
| P4 | Update `MOBILE_VERIFICATION_REPORT.md` (outdated vs wallet/Razorpay) | S |

---

## 5. OCPP gateway status

**Location:** `ocpp-gateway/`  
**Status:** Phase 1 implemented (local dev).

| Capability | Status |
|------------|--------|
| WebSocket OCPP 1.6J (Boot, Heartbeat, Status, Authorize, Start/Stop, MeterValues) | ✅ |
| REST API for web admin remote commands | ✅ |
| Supabase sync (chargers, connectors, sessions, meter values, events) | ✅ |
| Test client script | ✅ |
| Operational alert hooks (firmware, offline) | ✅ |
| TLS / WSS production deploy | ❌ |
| Smart charging profiles | ❌ |
| Physical lab validation (MyPower + Tri Square) | ❌ |
| Staging deploy + monitoring | ❌ |

---

## 6. Supabase backend status

### 6.1 Core schema (`supabase/schema.sql` + migrations)

Tables in active use: `EV_Users`, `EV_Chargers`, `EV_ChargerConnectors`, `EV_ChargingSessions`, `EV_MeterValues`, `EV_RFIDCards`, `EV_Tariffs`, `EV_Payments`, `EV_Receipts`, `EV_AuditLogs`, `EV_SupportTickets`, `EV_Notifications`, `EV_UserPreferences`, `EV_WalletAccounts`, `EV_WalletLedger`, `EV_PaymentOrders`, `EV_PaymentTransactions`, `EV_UserPushTokens`, `EV_ChargerEvents`, and related.

### 6.2 SQL scripts — deployment checklist

Run in Supabase SQL Editor (order matters for fresh env):

| # | Script | Purpose | Required |
|---|--------|---------|----------|
| 1 | `schema.sql` | Base tables | ✅ |
| 2 | `rls.sql` | RLS policies | ✅ |
| 3 | `rfp_roles.sql` | RFP role constraints | ✅ |
| 4 | `profile_and_storage.sql` | Profile, prefs, storage | ✅ |
| 5 | `auth_activity.sql` | Login history | ✅ |
| 6 | `notifications.sql` | Notification tables | ✅ |
| 7 | `operational_alerts.sql` | Phase 1 admin alerts (triggers) | ✅ |
| 8 | `phase2_operations_alerts.sql` | Phase 2 alerts (back online, low wallet, firmware) | ✅ |
| 9 | `enable_realtime.sql` | Supabase Realtime for bell, dashboard, sessions | ✅ |
| 10 | `charger_simulator.sql` | Simulator RPCs + policies | ✅ (UAT) |
| 11 | `payments_admin.sql` | Payment write policies | ✅ |
| 12 | `migrations/create_wallet_topup_tables.sql` | Wallet + Razorpay tables | ✅ |
| 13 | `payments_wallet_admin.sql` | Web admin read wallets/orders | ✅ |
| 14 | `mobile/SUPABASE_MOBILE_POLICIES.sql` | Mobile session/support RLS | ✅ |
| 15 | `mobile/CUSTOM_PUSH_NOTIFICATIONS.sql` | Push tokens + notification RLS | ✅ |
| 16 | `mobile/RAZORPAY_WALLET.sql` | Wallet top-up RPCs | ✅ |
| 17 | `mobile/SESSION_WALLET_PAYMENT.sql` | Pay session from wallet | ✅ |
| 18 | `seed.sql` | Demo data (optional) | Optional |

**Hotfixes (run if needed):** `fix_wallet_rpc_ambiguous.sql`, `fix_login.sql`, `fix_password_digest.sql`, `fix_payment_order_status_gateway.sql`

### 6.3 Security notes (production)

- Web and mobile use **anon key** with broad `USING (true)` policies for UAT.
- `EV_Users` denies anon SELECT — admin uses `list_ev_users()` SECURITY DEFINER RPC.
- **Before production:** tighten RLS, move writes to service-role backend, remove anon insert/update where possible.
- Service role key must **never** ship in web or mobile bundles.

---

## 7. Notifications & alerts

| Layer | Phase 1 | Phase 2 | Status |
|-------|---------|---------|--------|
| In-app (`EV_Notifications`) | Charger offline/fault, session start/stop, payment received/failed | — | ✅ DB triggers + **Supabase Realtime enabled** |
| In-app | — | Charger back online, low wallet balance | ✅ DB triggers |
| Email (Power Automate) | Admin prefs via `useAdminOperationalAlertEmail` | Firmware alerts via OCPP/RPC | ✅ |
| Mobile push (Expo) | Token registration on login | Server delivery | ⚠️ Client done; server TODO |
| Web push (Firebase) | Infrastructure only | — | ⚠️ Optional |

---

## 8. Payments & wallets (cross-cutting)

| Flow | Where | Status |
|------|-------|--------|
| Session billing record created | DB trigger on session end | ✅ |
| Pay from wallet (mobile) | `ev_pay_session_from_wallet` | ✅ |
| Wallet top-up (Razorpay) | Mobile + edge functions | ⚠️ Needs secrets + EAS build |
| Simulator / mock gateway payments | Web simulator + seed data | ✅ UAT |
| SBIePay payments (historical) | Seed / legacy data | ✅ Display only |
| Web admin payment actions | — | ❌ By design (read-only) |
| Web receipt download | HTML + print-to-PDF | ✅ |
| Mobile receipt PDF | `receiptPdf.ts` | ✅ |
| Refunds | — | ❌ Not implemented |
| Admin wallet adjust / block | — | ❌ Not implemented |

---

## 9. Phase plan (updated)

### Completed phases

| Phase | Scope | Status |
|-------|-------|--------|
| **0** | Foundation, simulation gating, OCPP gateway scaffold, EAS mobile setup | ✅ |
| **1** | Web auth, layout, dashboard | ✅ |
| **2** | Charger management | ✅ |
| **3** | Sessions + remote commands | ✅ |
| **4** | Users + RFID | ✅ |
| **5** | Tariffs + payments UI | ✅ (web now read-only payments) |
| **6** | Reports + audit logs | ✅ |
| **7** | Supabase integration | ✅ (connected to `fvveqziyusjgqejowkfp`) |
| **8** | Settings + profile | ✅ |
| **9** | Mobile end-user app (Expo) | ✅ |
| **10** | Wallet + Razorpay (mobile) | ⚠️ Code done; deploy secrets |
| **11** | Operational alerts (DB + email) | ✅ |
| **12** | Web payments & wallets admin (read-only) | ✅ |

### Remaining phases (recommended)

| Phase | Scope | Target | Priority |
|-------|-------|--------|----------|
| **13** | OCPP production (TLS, lab test, 12 chargers) | Production | P1 |
| **14** | Mobile push delivery end-to-end | Production | P1 |
| **15** | Razorpay production + EAS release | Production | P1 |
| **16** | RLS hardening + auth migration | Production | P1 |
| **17** | Maps API + `google-services.json` | Production | P2 |
| **18** | Firmware OTA management UI | RFP optional | P3 |
| **19** | Refunds + admin wallet tools | Business need | P3 |
| **20** | Hindi i18n on web admin | Parity with mobile | P3 |

---

## 10. Environment variables

### Web (`.env`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `VITE_SUPABASE_URL` | Yes | Supabase project |
| `VITE_SUPABASE_ANON_KEY` | Yes | Client access |
| `VITE_OCPP_GATEWAY_API_URL` | Prod | Remote charger commands |
| `VITE_ENABLE_SIMULATION` | No | Simulator in production (default off) |
| `VITE_PAYMENT_GATEWAY_URL` | No | Legacy; web payments are read-only |
| `POWER_AUTOMATE_EMAIL_URL` | Yes | Transactional emails |
| `VITE_FIREBASE_*` | No | Analytics / messaging |

### Mobile (`mobile/.env`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `EXPO_PUBLIC_SUPABASE_URL` | Yes | Supabase |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Yes | Client access |
| `EXPO_PUBLIC_API_BASE_URL` | No | REST fallback for wallet status |
| `EXPO_PUBLIC_OCPP_GATEWAY_API_URL` | Prod | Real charging (not wired yet) |
| `EXPO_PUBLIC_ENABLE_PAYMENT_MOCK` | No | Mock top-up in dev |

### OCPP gateway (`ocpp-gateway/.env`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `SUPABASE_URL` | Yes | Server sync |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server writes |
| `TLS_CERT_PATH` / `TLS_KEY_PATH` | Prod | WSS |

### Supabase Edge Function secrets

| Secret | Purpose |
|--------|---------|
| `RAZORPAY_KEY_ID` | Wallet top-up |
| `RAZORPAY_KEY_SECRET` | Wallet top-up |

---

## 11. Testing & UAT checklist

### Web admin

- [ ] Login as SuperAdmin and SiteAdmin; verify route restrictions
- [ ] Dashboard loads live stats
- [ ] Charger CRUD + detail OCPP commands (with gateway running)
- [ ] Start/stop session via simulator; verify sessions list
- [ ] Users CRUD + wallet column
- [ ] Payments: all 3 tabs show data (sessions, top-ups, wallets)
- [ ] Payment detail → download receipt (HTML)
- [ ] Support ticket workflow
- [ ] Reports export
- [ ] Settings: profile, password, notification prefs
- [ ] Operational alert appears on charger fault/offline (bell)

### Mobile

- [ ] Login as User (`rajesh.kumar@dfccil.gov.in` or seed user)
- [ ] QR or charger detail → start session (simulator)
- [ ] Live session → stop → session summary → pay from wallet
- [ ] Wallet top-up via Razorpay (EAS build + secrets)
- [ ] Payment history → download receipt PDF
- [ ] RFID bind/unbind
- [ ] Support ticket + attachment
- [ ] Notifications list + tap navigation
- [ ] Push token in `EV_UserPushTokens` after login (physical device)

### Integration

- [ ] OCPP test client connects; web remote start works
- [ ] Power Automate emails (welcome, ticket status)
- [ ] Supabase Realtime updates on dashboard and mobile home

---

## 12. Known gaps & risks

| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| 1 | Anon RLS too permissive | Data exposure | Phase 16 RLS hardening |
| 2 | Custom auth not tied to Supabase JWT | RLS bypass patterns | RPCs + future auth migration |
| 3 | No real OCPP on mobile | Can't charge at hardware | Phase 13 + gateway URL in mobile |
| 4 | Razorpay needs native build | Top-up fails in Expo Go | EAS preview/production builds |
| 5 | Push server not triggered | No mobile push delivery | Wire edge function to triggers |
| 6 | Demo login pre-filled | Security | Remove before prod |
| 7 | Stub receipt PDF URLs in DB | Broken links if used raw | Web uses HTML fallback (fixed) |
| 8 | `MOBILE_VERIFICATION_REPORT.md` outdated | Confusion | Update doc |
| 9 | 12 physical chargers not validated | Go-live blocker | Lab + staging with OCPP gateway |
| 10 | No refund / wallet admin tools | Ops manual work | Phase 19 |

---

## 13. Recommended next steps (priority order)

1. **Deploy OCPP gateway** to staging; connect 1 test charger; set web `VITE_OCPP_GATEWAY_API_URL`.
2. **Complete Razorpay production setup** — edge function secrets, EAS Android build, test top-up on device.
3. **Run remaining SQL** on Supabase if not applied (`SUPABASE_MOBILE_POLICIES.sql`, `CUSTOM_PUSH_NOTIFICATIONS.sql`, `payments_wallet_admin.sql`).
4. **Wire push delivery** — trigger `send-push-notification` from `EV_Notifications` insert or operational alert triggers.
5. **Add Google Maps key** + `google-services.json` for maps and FCM.
6. **RLS security review** before DFCCIL production cutover.
7. **Remove demo credentials** from web login; rotate Supabase anon key if exposed.
8. **Physical charger commissioning** — all 12 units through OCPP gateway with DFCCIL network team.

---

## 14. Document history

| Date | Change |
|------|--------|
| June 2026 | Initial completion plan created from full web + mobile review |
| June 2026 | Web payments & wallets read-only; receipt download; `list_ev_users` lookup fix |
| June 2026 | Merged main: mobile receipt PDF, payment history improvements |

**Related docs:** `project_plan.md` (original phase 1–8 plan), `README.md`, `mobile/PUSH_NOTIFICATION_SETUP.md`, `mobile/MOBILE_SUPABASE_SETUP.md`, `ocpp-gateway/README.md`

---

*This document should be updated after each major merge to `main` or before DFCCIL UAT / production milestones.*
