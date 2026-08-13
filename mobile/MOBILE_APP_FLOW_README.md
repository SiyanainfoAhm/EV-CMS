# DFCCIL EV CMS — Mobile App Flow

Client-facing guide to how the DFCCIL EV CMS mobile app works end to end.

> **Update:** In-app prepaid gateway checkout (Razorpay/HDFC) before charging has been removed from the mobile UI. Amount/time selection is now a **session limit** only. Payment is collected **physically / offline** after charging. Bill and receipt screens show Offline / Unpaid / Paid Offline status.

This document describes **mobile end-user** behaviour. Web admin RemoteStart is a separate path and is not used by the mobile app.

---

## Table of contents

1. [End-to-end happy path](#1-end-to-end-happy-path)
2. [Login](#2-login)
3. [Dashboard](#3-dashboard)
4. [Find chargers](#4-find-chargers)
5. [Charger status rules](#5-charger-status-rules)
6. [Select charger and connector](#6-select-charger-and-connector)
7. [Session limits (Charge by Amount / Time)](#7-session-limits-charge-by-amount--time)
8. [Tariff calculation (`EV_Tariffs`)](#8-tariff-calculation-ev_tariffs)
9. [Offline payment (no in-app gateway)](#9-offline-payment-no-in-app-gateway)
10. [Mobile logged-in user session start](#10-mobile-logged-in-user-session-start)
11. [RFID-mapped user flow](#11-rfid-mapped-user-flow)
12. [OCPP RemoteStart / RemoteStop](#12-ocpp-remotestart--remotestop)
13. [Live session and auto-stop](#13-live-session-and-auto-stop)
14. [Completion and receipt](#14-completion-and-receipt)
15. [API polling rules](#15-api-polling-rules)
16. [Error handling](#16-error-handling)
17. [Acceptance test checklist](#17-acceptance-test-checklist)

---

## 1. End-to-end happy path

```
Login
  → Home / Find Chargers
  → Station / Charger screen (select available connector)
  → Charge by Time or Charge by Amount Limit
  → Start Charging (no online payment)
  → OCPP RemoteStart (MOBILE-{userId})
  → Live session
  → Auto-stop or manual Stop
  → Bill / Receipt (Physical / Offline payment)
```

**Attribution rules**

| Start path | Who appears on the session | OCPP `idTag` | `authorization_method` | `started_by` |
|------------|----------------------------|--------------|------------------------|--------------|
| Mobile app (logged-in user) | Logged-in mobile user | `MOBILE-{userId}` | `Mobile` | `mobile` |
| Physical RFID at charger | User mapped on `EV_RFIDCards` | RFID UID | `RFID` | `rfid` |

The mobile app **never** uses `ADMIN-BYPASS`. That tag is for web admin only.

---

## 2. Login

1. User opens the app and lands on **Login** if no valid session exists.
2. Credentials are verified via the `verify_ev_login` RPC (email + password).
3. Only users with status **active** can sign in.
4. A local mobile session is stored (token style `ev_mobile_{userId}_{timestamp}`, TTL ~30 days).
5. Push tokens may be registered after login.
6. Successful login navigates to **Home (Dashboard)**.

Payment Edge Functions identify the caller with the authenticated user id (for example `X-User-Id`). Secrets are **not** stored in the mobile app.

---

## 3. Dashboard

The Home screen shows:

- Greeting, notifications, profile
- Summary counts: **Online · Offline · Charging**
- Banner if the user has an **active** charging session → opens Live Session
- Recent completed sessions
- Quick actions based on role (end users see charging actions; admin roles see limited mobile menus)

**How counts are calculated**

- Source: `EV_Chargers.status` (same idea as web admin charger list)
- **Online:** status is `online` or `available`
- **Offline:** status is `offline`
- **Charging:** number of connectors with status `Charging` (connector-level, separate from charger Online/Offline)

Heartbeat age may be shown for information elsewhere, but it does **not** drive Online/Offline filters or dashboard Online/Offline counts.

---

## 4. Find chargers

1. Open **Chargers**.
2. App loads chargers from `EV_Chargers` (plus connectors).
3. Simulated chargers are hidden unless Simulation Mode is enabled.
4. Search filters by name / charge point id / location (debounced; list is filtered locally after fetch).
5. Status tabs:

| Tab | Shows |
|-----|--------|
| All | Every fetched charger |
| Online | `status` ∈ `online`, `available` |
| Offline | `status` = `offline` |
| Faulted | `status` ∈ `faulted`, `error`, `unavailable` |

Offline and faulted chargers appear under **All** and their own tabs. They must **not** appear under **Online**.

---

## 5. Charger status rules

**Primary source of truth:** `public."EV_Chargers".status`

| DB status | Badge | In Online tab? | Charging / payment allowed? |
|-----------|-------|----------------|-----------------------------|
| `online` / `available` | Online | Yes | Yes (if connector also startable) |
| `offline` | Offline | No | No |
| `faulted` / `error` / `unavailable` | Faulted | No | No |
| empty / unknown | Unknown | No | No |

**Important**

- Connector chips (e.g. G1 Available, G2 Charging) are separate UI.
- OCPP socket live/disconnected (if shown) is separate.
- Neither connector state nor socket state overrides charger Online/Offline for filters or start gates.
- Example: charger `status = offline` and connector `Available` → badge **Offline**, start **blocked**.

If the user taps Start / Pay on an offline charger:

> This charger is currently offline. Please select an online charger.

(or the equivalent localized string for offline / faulted / unavailable.)

---

## 6. Select charger and connector

On **Charger Detail**:

1. User must be a mobile end-user role to see Start / QR actions.
2. Charger must pass the online gate (`online` / `available`).
3. User selects a connector (gun).
4. Connector must be startable: status `Available` or `Preparing`, and no active session on that gun.
5. If the gun is still **Available** (cable not ready), the app asks the user to **plug in the cable** and wait until the gun shows **Preparing**, then try again.
6. Only then does the prepaid plan modal open.

QR start follows the same charger-online and connector-availability checks.

---

## 7. Prepaid plans (Pay by Amount / Pay by Time)

Plans come from `EV_PrepaidPlans` (with sensible defaults if needed).

### Pay by Amount

- User chooses an INR amount (within configured min/max, typically ₹50–₹10,000).
- Tariff rate, session fee, and GST are applied.
- App estimates energy (kWh) the prepaid amount can buy after session fee and GST.
- Session is limited by that **energy cap** during live charging.

### Pay by Time

- User chooses a duration (minutes, within configured limits).
- Estimated energy ≈ charger power × hours.
- Cost = energy charge + session fee + GST.
- Session is limited by **time** (`prepaidExpiresAt` or start + duration).

User confirms the plan → payment flow starts. Create-order and checkout APIs run only on explicit Pay action (not on screen open).

---

## 8. Tariff calculation (`EV_Tariffs`)

For the selected charger, the app resolves an active tariff:

1. Charger-specific `tariff_id` on `EV_Chargers` if that tariff is active  
2. Else a type-matching active row from `EV_Tariffs` (`AC Slow` / `DC Fast`)  
3. Else a safe client fallback rate (only if no DB tariff)

Used fields typically include:

- Rate per kWh  
- Session fee  
- GST percent  

The prepaid modal shows today’s rate and fee before Pay.

---

## 9. Payment and gateway selection

### Dynamic gateway (`EV_SystemConfig`)

Active gateway is chosen from public config (no secrets in the app):

- Config key: payment gateway settings in `EV_SystemConfig`
- If **`testing_mode`** is on → use **test gateway** (typically **Razorpay**)
- If **`testing_mode`** is off → use **production gateway** (typically **HDFC**)

SuperAdmin can toggle testing mode from web Settings. Mobile only reads the public config (gateway name, testing flag, currency, etc.).

### Secrets

- Razorpay / HDFC keys and secrets live only in **Supabase Edge Function secrets** (and server-side env).
- The mobile app never embeds merchant secrets.
- Order create / verify go through Edge Functions, for example:
  - `ev-cms-mobile-session-create-razorpay-order`
  - `ev-cms-mobile-session-verify-razorpay-payment`
- Functions read `testing_mode`, create the order with the active gateway, and verify signatures server-side.

### Payment sequence

1. Re-check charger is still online.  
2. Create a **pending_payment** session for the logged-in user.  
3. Attach a pending payment record.  
4. Call create-order Edge Function (once; guard against double-tap).  
5. Open checkout (Razorpay checkout, or HDFC when configured).  
6. On gateway success → verify Edge Function.  
7. On verified payment → OCPP RemoteStart.  
8. On cancel / fail → user sees a clear error; no charging start.

If HDFC is selected but not yet configured on the backend, the user receives a clear “not configured” style error (no silent fallback that exposes secrets).

---

## 10. Mobile logged-in user session start

After successful payment verification:

| Field | Value |
|-------|--------|
| Session `user_id` | Logged-in mobile user |
| OCPP `idTag` | `MOBILE-{userId}` |
| `authorization_method` | `Mobile` |
| `started_by` | `mobile` |
| `bypassRfid` | `false` |
| Prepaid flags | Paid / prepaid mode and caps stored on session |

The OCPP gateway authorizes `MOBILE-{userId}` by looking up the user in `EV_Users` (must be active). No RFID card row is required for mobile starts.

**Sessions started from the mobile app must always show the logged-in user** in history, live session, and admin views (via `user_id`).

---

## 11. RFID-mapped user flow

RFID is **not** started from a “tap RFID in the app” charge button. Typical RFID path:

1. User binds a physical card in the app (**RFID Binding**) → `EV_RFIDCards.user_id` = that user.  
2. User presents the card at the charger.  
3. Charger sends OCPP Authorize / StartTransaction with the RFID UID.  
4. Gateway maps the card → user and creates the session:

| Field | Value |
|-------|--------|
| Session `user_id` | Mapped RFID user |
| `rfid_card_id` | Card id |
| `authorization_method` | `RFID` |
| `started_by` | `rfid` |

**RFID sessions must show the mapped RFID user**, not a generic tag and not a web admin identity.

If the user later opens Live Session / History for that same account, RFID sessions appear under their user id.

Unassigned or inactive RFID cards must not authorize charging.

---

## 12. OCPP RemoteStart / RemoteStop

### RemoteStart (mobile prepaid)

After pay + verify:

1. App may wait briefly for connector **Preparing** (cable ready).  
2. App calls the OCPP gateway REST **RemoteStart** with:
   - `chargePointId`, `connectorId`
   - `idTag = MOBILE-{userId}`
   - `userId` (session owner)
   - `prepaidPaid = true` (and payment/session ids as applicable)
3. Gateway sends OCPP `RemoteStartTransaction` to the charger.  
4. Charger starts; `StartTransaction` creates/updates the live session under the logged-in user.  
5. App polls until an active session appears, then opens **Live Session**.

### RemoteStop

- Manual: user taps Stop → confirm → gateway **RemoteStop** with `transactionId`.  
- Auto: prepaid energy or time limit reached → same stop path.  
- After stop, session moves to completed / summary.

Mobile stop does not use admin RFID bypass.

---

## 13. Live session and auto-stop

**Live Session** screen shows energy, power, duration, prepaid limit progress, and Stop.

### Auto-stop (prepaid)

Client-side backup when the session is prepaid and already paid:

- Skip very early seconds (grace window).  
- **Amount mode:** stop when consumed kWh reaches prepaid energy cap.  
- **Time mode:** stop when `prepaidExpiresAt` (or start + duration) is reached.  
- Then call stop once (loading / in-flight guard to avoid duplicate stop requests).

### Manual stop

User confirms → single stop request → navigate to summary when session ends.

Realtime updates plus a modest poll keep the UI fresh while the screen is focused. Leaving the screen stops that live poll.

---

## 14. Completion and receipt

After stop (auto or manual):

1. User sees **Session Summary** (energy, duration, amount, charger, times).  
2. For **completed prepaid** sessions:
   - Payment is already settled.
   - UI shows prepaid / already paid messaging.
   - **Do not show “Pay Now” again.**
3. Post-session Pay Now is only for non-prepaid / unpaid cases (if any legacy path exists). Prepaid prepaid-paid sessions must not reopen checkout.

---

## 15. API polling rules

Goal: avoid continuous unnecessary API load.

| Screen / action | Recommended behaviour |
|-----------------|------------------------|
| Charger list / Home | Load on open / focus; refresh via realtime and/or pull-to-refresh; no aggressive sub-5s polling |
| Live session (active only) | ~**5 seconds** poll + realtime; **stop polling on leave** |
| Duration clock on live screen | Local 1s tick only (not a network call) |
| Session history | Load on open / after action; no continuous poll |
| Create payment order | **Once** on Pay (block double-tap) |
| Verify payment | **Once** after gateway success/callback |
| Stop charging | **Once** per user action or auto-stop trigger |
| Payment gateway public config | Cached briefly (e.g. ~30s) |

Clear all intervals and unsubscribe Supabase channels on unmount / blur.

---

## 16. Error handling

| Situation | Expected behaviour |
|-----------|--------------------|
| Charger offline / faulted | Block prepaid modal; show offline/faulted message |
| Gun Available (not Preparing) | Ask to plug cable; do not open payment |
| Gun busy / faulted | Block start; show gun-specific message |
| User cancels payment | Clear cancel message; no RemoteStart |
| Payment / order failure | Failure message; session stays unpaid / cancelled as designed |
| Gateway not configured (e.g. HDFC) | Explicit configuration error from backend |
| RemoteStart rejected / session never starts | Error after payment; do not leave user on a fake live session |
| Inactive user | Login or start blocked with inactive messaging |
| Duplicate Pay / Stop taps | Ignored while request in flight |

Never surface raw secrets, merchant keys, or Edge Function env values in UI or logs meant for end users.

---

## 17. Acceptance test checklist

### Auth and dashboard

- [ ] Valid active user can log in and reach Home.  
- [ ] Inactive user cannot use the app.  
- [ ] Online / Offline counts match `EV_Chargers.status` (same idea as web).  
- [ ] Active session banner opens Live Session.

### Charger list and status

- [ ] Online tab shows only `online` / `available` chargers.  
- [ ] Offline charger (e.g. status `offline`) does **not** appear in Online.  
- [ ] Offline charger shows Offline badge and appears in All / Offline.  
- [ ] Faulted charger appears in Faulted; charging blocked.  
- [ ] Connector “Available” on an offline charger does **not** allow Pay.

### Connector and prepaid

- [ ] Online charger + Preparing gun opens prepaid modal.  
- [ ] Available gun shows plug-cable guidance before Pay.  
- [ ] Pay by Amount shows estimated kWh and total with GST.  
- [ ] Pay by Time shows duration limit and total with GST.  
- [ ] Tariff matches charger override or type default from `EV_Tariffs`.

### Payment

- [ ] With `testing_mode` on, checkout uses the configured test gateway (e.g. Razorpay).  
- [ ] With `testing_mode` off, app routes toward production gateway (e.g. HDFC) without embedding secrets.  
- [ ] Create order runs only on Pay; verify only after gateway success.  
- [ ] Double-tap Pay does not create duplicate orders.  
- [ ] Cancelled payment does not start charging.

### Mobile session attribution

- [ ] After paid start, session `user_id` is the **logged-in mobile user**.  
- [ ] OCPP / session uses `MOBILE-{userId}`, method **Mobile**, started_by **mobile**.  
- [ ] Mobile path never sends or relies on `ADMIN-BYPASS`.

### RFID

- [ ] Bound RFID card at charger creates a session for the **mapped RFID user**.  
- [ ] Unassigned RFID cannot start.  
- [ ] RFID session appears in that user’s history / live view when applicable.

### Live session and stop

- [ ] Live Session updates while focused; polling stops when leaving.  
- [ ] Manual Stop ends the session once.  
- [ ] Amount prepaid auto-stops near energy cap.  
- [ ] Time prepaid auto-stops at expiry.  
- [ ] Summary opens after stop.

### Receipt

- [ ] Completed **prepaid** session summary shows paid / prepaid state.  
- [ ] **No “Pay Now”** button for completed prepaid sessions.

### Security / ops

- [ ] No merchant secrets in the mobile binary or client config.  
- [ ] Edge Function secrets hold gateway credentials.  
- [ ] Charger list is not hammering APIs in a tight loop.

---

## Quick reference — what mobile is and is not

| Topic | Mobile behaviour |
|-------|------------------|
| Who owns a mobile start | Logged-in user |
| Who owns an RFID start | Mapped RFID user |
| Admin bypass idTag | **Not used** on mobile |
| Charger Online filter | `EV_Chargers.status` only |
| Payment secrets | Edge Function secrets only |
| Gateway switch | `EV_SystemConfig` / `testing_mode` (no redeploy needed for toggle) |
| Prepaid completion | Already paid → **no Pay Now** |

---

*Document version: aligned with DFCCIL EV CMS mobile prepaid + OCPP flow. Update this file when gateway production (HDFC) go-live steps or prepaid limits change.*
