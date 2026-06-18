# Push Notification Setup (DFCCIL EV Mobile)

## Overview

The mobile app registers **Expo push tokens** in `EV_UserPushTokens` linked to **`EV_Users.id`** (custom email/password auth — not Supabase Auth `auth.users`).

In-app notification history uses **`EV_Notifications`** (`message` = body, `read` = is_read).

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

1. Configure Firebase project for your Android app package `in.dfccil.evcms`.
2. Upload FCM credentials in [Expo EAS credentials](https://docs.expo.dev/push-notifications/fcm-credentials/).
3. **Do not** commit `google-services.json` secrets to public repos if policy forbids it.
4. Build with `eas build --platform android`.

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
- No Firebase secrets in mobile source code.

## Dev-only local test

On Notifications screen in `__DEV__`, tap **DEV: Local test push** to schedule a local notification (no server).
