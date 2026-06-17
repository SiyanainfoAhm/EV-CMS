# Mobile Supabase Setup

Run these SQL scripts in **Supabase Dashboard → SQL Editor** in order (safe to re-run where noted).

## Required order

| Step | File | Purpose |
|------|------|---------|
| 1 | `supabase/schema.sql` | Tables |
| 2 | `supabase/rls.sql` | Read policies + `verify_ev_login` |
| 3 | `supabase/seed.sql` | Demo data |
| 4 | `supabase/policies_write.sql` | Admin CRUD RPCs |
| 5 | `supabase/profile_and_storage.sql` | Profile + avatars |
| 6 | `supabase/fix_login.sql` | Login fixes (if needed) |
| 7 | **`mobile/SUPABASE_MOBILE_POLICIES.sql`** | **P0 — Mobile writes** |
| 8 | **`mobile/WALLET_TOPUP_SCHEMA.sql`** | **Wallet + top-up tables & RPCs** |
| 9 | **`mobile/CUSTOM_PUSH_NOTIFICATIONS.sql`** | **Push token columns + notification fields** |

## Wallet & top-up: `WALLET_TOPUP_SCHEMA.sql`

Run after step 7 to enable prepaid wallet screens:

- `EV_WalletAccounts`, `EV_WalletLedger`, `EV_PaymentOrders`, `EV_PaymentTransactions`, `EV_PaymentWebhooks`
- RPCs: `ev_get_wallet_summary`, `ev_create_topup_order`, `ev_get_payment_order_status`, `ev_get_wallet_ledger`
- Mobile can **create** top-up orders only; wallet balance is **not** credited from the app

### Verify wallet RPC

```sql
SELECT * FROM ev_get_wallet_summary('a0000001-0000-4000-8000-000000000001');
```

Replace with your `EV_Users.id`. Usable balance starts at ₹0 until gateway/webhook credits the wallet.


This file enables the mobile app (anon key, demo) to:

- **Insert/update** `EV_ChargingSessions` (start/stop charging)
- **Insert** `EV_SupportTickets`
- **Manage** `EV_UserPushTokens` (FCM/Expo push)
- **Upload** profile images to `ev-media` storage bucket
- **Set GPS coordinates** on seed chargers for nearest-map

### How to run

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project
2. Go to **SQL Editor** → **New query**
3. Paste contents of `mobile/SUPABASE_MOBILE_POLICIES.sql`
4. Click **Run**
5. Confirm success (no errors)

### Verify policies

```sql
SELECT tablename, policyname
FROM pg_policies
WHERE tablename IN ('EV_ChargingSessions', 'EV_SupportTickets', 'EV_UserPushTokens')
ORDER BY tablename, policyname;
```

### Verify push token table

```sql
SELECT * FROM "EV_UserPushTokens" LIMIT 5;
```

### Verify charger coordinates

```sql
SELECT charge_point_id, latitude, longitude FROM "EV_Chargers" WHERE latitude IS NOT NULL;
```

## RLS summary (mobile)

| Table | Mobile access |
|-------|----------------|
| `EV_Users` | Login via `verify_ev_login` RPC only |
| `EV_Chargers` / `EV_ChargerConnectors` | Read (anon) |
| `EV_ChargingSessions` | Insert/update (after mobile policies) |
| `EV_SupportTickets` | Read all (demo), insert own |
| `EV_Payments` / `EV_Receipts` | Read (filtered by `user_id` in app) |
| `EV_RFIDCards` | Read + bind (existing policies) |
| `EV_UserPushTokens` | CRUD own tokens |

> Production: tighten RLS to filter support tickets and sessions by `user_id` server-side.

## Supabase CLI (optional)

If linked to your project:

```bash
supabase db execute --file mobile/SUPABASE_MOBILE_POLICIES.sql
```

## Demo login

- **Email:** `rajesh.kumar@dfccil.gov.in`
- **Password:** `dfccil123`

## Manual steps after SQL

1. **Google Maps API key** — set in `mobile/app.json` → `android.config.googleMaps.apiKey` for map markers on Android
2. **Rebuild native app** — camera, location, maps, push require native rebuild:
   ```bash
   cd mobile
   npx expo prebuild --platform android
   cd android && ./gradlew.bat assembleRelease
   ```
3. **FCM** — Expo push uses EAS `projectId` in `app.json`. For production FCM, add `google-services.json` via EAS credentials.
