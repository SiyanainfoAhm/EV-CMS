# Web Browser Push (FCM) — DFCCIL EV Admin

## Overview

Web admins can receive **OS/browser notifications** via Firebase Cloud Messaging when:

- Browser push is enabled in **Settings → Notifications**
- `VITE_FIREBASE_VAPID_KEY` is set in `.env`
- Edge function `send-push-notification` is deployed with Firebase service account
- DB trigger `web_push_dispatch.sql` is applied with matching dispatch secret

In-app bell alerts (Supabase Realtime) work independently while the portal is open.

## 1. Firebase Console

1. Project: **dffcilevcms**
2. **Project settings → Your apps → Web app** — copy config into `.env` (`VITE_FIREBASE_*`)
3. **Build → Cloud Messaging → Web Push certificates** — generate key pair → set `VITE_FIREBASE_VAPID_KEY`
4. **Project settings → Service accounts → Generate new private key** — JSON for edge function secret

## 2. Environment (`.env`)

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=dffcilevcms.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=dffcilevcms
VITE_FIREBASE_STORAGE_BUCKET=dffcilevcms.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_VAPID_KEY=...   # Web Push certificate public key
```

Restart dev server after changes (`npm run dev` regenerates `public/fcm-web-config.json`).

## 3. Supabase Edge Function secrets

```bash
supabase secrets set EV_PUSH_DISPATCH_SECRET=your-long-random-secret
supabase secrets set FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
supabase functions deploy send-push-notification --no-verify-jwt
```

## 4. Database trigger

Run `supabase/web_push_dispatch.sql`, then set the same secret in Postgres:

```sql
ALTER DATABASE postgres SET app.ev_push_dispatch_secret = 'your-long-random-secret';
```

Also ensure `mobile/CUSTOM_PUSH_NOTIFICATIONS.sql` has been applied (`token_type` column on `EV_UserPushTokens`).

## 5. Enable in the app

1. Log in as Super Admin / Site Admin
2. **Settings → Notifications → Enable browser push**
3. Allow notifications when the browser prompts
4. **Dashboard → Test notification** — bell updates live; minimize the tab to see OS notification

## 6. Token storage

| Field | Web FCM |
|-------|---------|
| Table | `EV_UserPushTokens` |
| `token_type` | `fcm_web` |
| `platform` | `web` |

Tokens are deactivated on logout for this browser.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Enable button disabled | Set `VITE_FIREBASE_VAPID_KEY` and restart dev server |
| Permission denied | Reset site notification permission in browser settings |
| Bell works, no OS push | Deploy edge function + DB trigger + `FIREBASE_SERVICE_ACCOUNT_JSON` |
| Service worker errors | Hard refresh; check `public/fcm-web-config.json` exists after `npm run dev` |
