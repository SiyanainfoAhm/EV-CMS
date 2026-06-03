# Mobile App Verification Report

**Date:** 2026-06-02  
**Scope:** `mobile/` only (web admin untouched)  
**Overall status:** **Partial** — core read flows and custom auth are connected to the same Supabase project; write flows (start/stop session, support tickets) require one SQL script on Supabase.

---

## Summary

| Area | Result |
|------|--------|
| Custom auth (no Supabase Auth) | **Pass** |
| Session persistence (app restart) | **Pass** |
| Navigation protection | **Pass** |
| User data isolation (`user_id` filters) | **Pass** |
| Live reads (chargers, sessions, payments, RFID) | **Pass** |
| CRUD (profile, RFID bind/unbind) | **Pass** |
| CRUD (start/stop session, support ticket) | **Partial** — needs `SUPABASE_MOBILE_POLICIES.sql` |
| Mock data as primary source | **Removed** |
| OCPP / payment gateway | **Not wired** (env placeholders only) |
| QR camera scanner | **Partial** — manual QR payload + validated start |

---

## 1. Startup & config

| Check | Status | Notes |
|-------|--------|-------|
| `package.json` scripts | Pass | `start`, `android`, `ios`, `web`, `typecheck` |
| `app.json` | Pass | Expo 52, `expo-asset`, `expo-font` plugins |
| `tsconfig.json` | Pass | Strict mode, path alias `@/*` |
| Entry `index.ts` → `App.tsx` | Pass | `AuthProvider` + `NavigationContainer` |
| `npm install` + `npx expo start` | Pass | Web deps installed (`react-native-web`, `react-dom`, etc.) |

---

## 2. Environment

| Variable | Required | In `.env` | Used for |
|----------|----------|-----------|----------|
| `EXPO_PUBLIC_SUPABASE_URL` | Yes | Yes | Supabase client |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Yes | Yes | Supabase client (anon only) |
| `EXPO_PUBLIC_API_BASE_URL` | No | Empty | Reserved for future REST API |
| `EXPO_PUBLIC_OCPP_GATEWAY_API_URL` | No | Empty | Future OCPP remote start/stop |
| `EXPO_PUBLIC_PAYMENT_GATEWAY_URL` | No | Empty | Future payment/receipt gateway |

**Service role key:** Not present in mobile code or `.env` (verified).

Template: `mobile/.env.example`

---

## 3. Custom authentication

| Check | Status | Implementation |
|-------|--------|----------------|
| Uses `verify_ev_login` RPC | Pass | `authService.ts` |
| No `supabase.auth` | Pass | Grep clean |
| Active user check | Pass | Rejects non-`active` status |
| Secure session storage | Pass | `@react-native-async-storage/async-storage` |
| Token format + 8h expiry | Pass | `ev_mobile_{userId}_{timestamp}` |
| Restore on cold start | Pass | `AuthContext` + `restoreSession()` |
| Logout clears storage | Pass | `signOut()` → `clearStoredSession()` |
| Profile enrichment | Pass | `get_ev_user_profile` after login |

**Demo login:** `rajesh.kumar@dfccil.gov.in` / `dfccil123`

---

## 4. Navigation protection

| Check | Status |
|-------|--------|
| Unauthenticated → Login only | Pass |
| Authenticated → Home stack only (no Login route) | Pass |
| Logout → Login (session cleared) | Pass |
| Direct stack access without login | Blocked |

---

## 5. Screens verified

### HomeScreen — **Pass (API)**

- Logged-in user from `AuthContext`
- Online charger count from `EV_Chargers`
- Active session for **current user only**
- Recent sessions (last 3, user-scoped)

### ChargerListScreen — **Pass (API)**

- `getChargers()` with status chips (`all` / `online` / `offline` / `faulted`)
- Debounced search on name, `charge_point_id`, location
- Status values from database (no mock list)

### ChargerDetailScreen — **Pass (API)**

- `getChargerById()` direct query (includes offline/faulted)
- Connectors from `EV_ChargerConnectors`
- Select available connector; blocks start if not `Available`

### QRStartScreen — **Partial**

- Parses JSON / `evcms://` / `CHARGE_POINT:connector` via `qrParser.ts`
- Invalid payload → error alert
- Valid target → `startSession()` insert (needs mobile policies SQL)
- Camera scanner UI placeholder (paste payload for demo)

### LiveSessionScreen — **Pass (API)**

- Active session filtered by `user_id`
- Duration, kWh, power, SoC, cost from `EV_ChargingSessions`
- Poll every 10s on focus
- Stop → `stopSession()` update (needs mobile policies SQL)

### SessionHistoryScreen — **Pass (API)**

- `getSessionHistory()` with `user_id` + `status != active`

### PaymentHistoryScreen — **Pass (API)**

- `EV_Payments` filtered by `user_id`
- Joins `EV_Receipts` for receipt number / PDF placeholder

### RFIDBindingScreen — **Pass (API)**

- Lists cards where `user_id` = logged-in user
- Bind by UID (insert or update `EV_RFIDCards`)
- Unbind sets `user_id` null, status `inactive`
- Prevents binding card already owned by another user

### ProfileScreen — **Pass (API)**

- Loads `get_ev_user_profile`
- Edit + save via `update_ev_user_profile` RPC
- Sign out clears session

### SupportScreen — **Partial**

- Inserts into `EV_SupportTickets` (`user_id`, `subject`, `description`, `status`, `priority`)
- Success/error UI
- Requires `SUPABASE_MOBILE_POLICIES.sql` for anon insert

### LoginScreen — **Pass**

- Uses `useAuth().signIn` (no navigation hack)

---

## 6. Service layer (`mobile/src/services/`)

| Service | Real Supabase/API | User-scoped | Error handling | Mock fallback |
|---------|-------------------|---------------|----------------|---------------|
| `authService.ts` | Yes (RPC) | N/A | Yes | None |
| `chargerService.ts` | Yes | N/A (all chargers for operators) | Throws | None |
| `sessionService.ts` | Yes | Yes (`user_id`) | Throws + policy hint | None |
| `paymentService.ts` | Yes | Yes | Throws | None |
| `rfidService.ts` | Yes | Yes | Throws | None |
| `profileService.ts` | Yes (RPC) | Yes (`user_id`) | Throws | None |
| `supportService.ts` | Yes | Yes | Throws + policy hint | None |

**Removed:** `src/data/mockData.ts` (was unused).

---

## 7. User data isolation

All mobile user-specific queries filter by logged-in `user.id`:

- Active / history / recent sessions
- Payments
- RFID cards (list + bind/unbind guards)

Charger list is intentionally **not** user-filtered (site inventory for drivers/operators).

---

## 8. Filters verification

| Screen | Server-side filter |
|--------|-------------------|
| Chargers | Status + `ilike` search on Supabase |
| Sessions history | `user_id` + non-active |
| Payments | `user_id` |
| RFID | `user_id` |

---

## 9. Bugs found & fixed

| Bug | Fix |
|-----|-----|
| Session only in memory (lost on restart) | AsyncStorage + `restoreSession()` |
| All routes visible without login | Conditional `Stack.Navigator` + `AuthProvider` |
| Sessions/payments showed **all users** | `.eq("user_id", …)` on queries |
| `getChargerById` only searched online list | Direct `EV_Chargers` query by id |
| `startSession` / `stopSession` stubs | Real insert/update with clear RLS error message |
| `bindRfid` returned fake object | Real `EV_RFIDCards` insert/update |
| Support screen TODO only | `supportService.createSupportTicket()` |
| Profile read-only | Edit profile via RPC |
| Mobile avatar missing | Upload/replace/delete avatar in `ev-media` + store `avatar_url` |
| `mockData.ts` unused but present | Deleted |
| Web bundle missing deps | `react-native-web`, `react-dom`, `expo-font` (prior fix) |
| TypeScript errors (navigation, View import) | Fixed |

---

## 10. Pending items

1. **Run** `mobile/SUPABASE_MOBILE_POLICIES.sql` in Supabase SQL Editor so mobile can insert/update sessions and create support tickets.
2. **Run** `supabase/fix_login.sql` if login RPC still errors (ambiguous column).
3. **Run** `supabase/profile_and_storage.sql` if profile RPCs are missing.
4. **OCPP gateway:** wire `EXPO_PUBLIC_OCPP_GATEWAY_API_URL` when backend exists (remote start/stop on hardware).
5. **Payment gateway:** wire `EXPO_PUBLIC_PAYMENT_GATEWAY_URL` for live payments/receipt PDFs.
6. **QR camera:** add `expo-camera` / barcode scanner (optional; manual payload works for demo).
7. **Production security:** replace broad anon write policies with backend API + service role.

---

## 11. Commands

```bash
cd mobile
npm install
npm run typecheck    # optional
npx expo start       # scan QR with Expo Go, or press a / w
```

**Supabase setup (once per project):**

```text
schema.sql → rls.sql → seed.sql → policies_write.sql → profile_and_storage.sql → fix_login.sql → SUPABASE_MOBILE_POLICIES.sql
```

---

## 12. Auth verification result

- **Custom auth:** Pass (`verify_ev_login`, no Supabase Auth)
- **Session storage:** Pass (AsyncStorage, not service role)
- **Navigation guard:** Pass

---

## 13. CRUD verification result

| Operation | Table | Status |
|-----------|-------|--------|
| Read chargers | `EV_Chargers` | Pass |
| Read connectors | `EV_ChargerConnectors` | Pass |
| Read/write profile | `EV_Users` via RPC | Pass |
| Read sessions | `EV_ChargingSessions` | Pass |
| Start/stop session | `EV_ChargingSessions` | Partial (needs policies SQL) |
| Read payments/receipts | `EV_Payments`, `EV_Receipts` | Pass |
| Bind/unbind RFID | `EV_RFIDCards` | Pass |
| Create support ticket | `EV_SupportTickets` | Partial (needs policies SQL) |

---

*Web admin (`src/`) was not modified during this audit.*
