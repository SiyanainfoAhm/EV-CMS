# Push Notification Setup (DFCCIL EV Mobile)

## Overview

The mobile app registers **Expo push tokens** in `EV_UserPushTokens` linked to **`EV_Users.id`** (custom email/password auth — not Supabase Auth `auth.users`).

In-app notification history uses **`EV_Notifications`** (`message` = body, `read` = is_read).

## Push Notification Production Setup

1. Android package name must be `in.dfccil.evcms`.
2. Firebase Android app must use the same package name.
3. `google-services.json` should be placed at `mobile/google-services.json`.
4. `app.json` must include:
   - `android.package` = `in.dfccil.evcms`
   - `android.googleServicesFile` = `./google-services.json`
5. `expo-notifications` plugin must be added.
6. Firebase service account private key must be uploaded to EAS credentials for FCM V1.
7. Do not store Firebase private key in mobile source code.
8. Build Android using EAS:
   - `eas build --platform android --profile preview`
   - `eas build --platform android --profile production`
9. Test push on a physical Android device, not only emulator.
10. Backend/Supabase Edge Function will send push using Expo Push API.

## SQL setup

Run in Supabase SQL Editor (after `SUPABASE_MOBILE_POLICIES.sql`):

1. `mobile/CUSTOM_PUSH_NOTIFICATIONS.sql` — extends tables + RLS

Optional seed notifications: `supabase/notifications.sql`

Enable **Realtime** for `EV_Notifications` in Dashboard → Database → Replication.

## Testing checklist

1. Use a **physical device** (push does not work on emulators/simulators for production tokens).
2. Login with email/password — permission prompt should appear (non-blocking).
3. Verify token in `EV_UserPushTokens` with correct `user_id` and `is_active = true`.
4. Logout — tokens should be marked `is_active = false`.
5. Insert a test row in `EV_Notifications` for the logged-in user.
6. Open app → bell badge → Notifications screen.

## Expo Go vs EAS builds

| Environment | Push support |
|-------------|----------------|
| Expo Go | Limited; good for UI/list testing |
| EAS development/preview build | Recommended for real push |
| Production APK/IPA | Required for DFCCIL rollout |

## Android FCM / production

1. Firebase project: `dffcilevcms` (package `in.dfccil.evcms`).
2. `google-services.json` is wired via `app.json` → `android.googleServicesFile`.
3. Upload **FCM V1 service account** credentials in [Expo EAS credentials](https://docs.expo.dev/push-notifications/fcm-credentials/):
   ```bash
   eas credentials
   ```
   Select Android → production/preview → Google Service Account Key for FCM V1.
4. **Do not** commit Firebase service account private key JSON files.
5. Build with `eas build --platform android`.

## iOS

1. Configure APNs key in EAS credentials.
2. Build with `eas build --platform ios`.

## Backend push delivery (later)

1. Backend inserts notification via `ev_notify_user()` or service role.
2. Trigger Edge Function `send-push-notification` with `notificationId`.
3. Function reads `EV_UserPushTokens`, sends to Expo Push API.
4. Updates `push_sent` / `push_sent_at` on `EV_Notifications`.

**Never** put Supabase service role key or Firebase server keys in the mobile app.

## Environment

- `app.json` → `extra.eas.projectId` must be set (already configured).
- No Firebase secrets in mobile TypeScript source code.
