import type { MessagePayload } from "firebase/messaging";
import { FCM_SW_SCOPE } from "@/utils/fcmManualRegistration";
import { resolveVapidKey } from "@/utils/firebaseWebConfig";
import { requireSupabase } from "@/utils/supabaseClient";

const WEB_PUSH_ENABLED_KEY = "ev_cms_web_push_enabled";
const WEB_PUSH_DEVICE_ID_KEY = "ev_cms_web_push_device_id";

let registrationInFlight: Promise<string> | null = null;

export type WebPushStatus = "unsupported" | "disabled" | "denied" | "ready" | "error";

export interface WebPushRegistrationResult {
  ok: boolean;
  status: WebPushStatus;
  token?: string;
  message?: string;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(WEB_PUSH_DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(WEB_PUSH_DEVICE_ID_KEY, id);
  }
  return id;
}

export function isWebPushEnabledInSettings(): boolean {
  return localStorage.getItem(WEB_PUSH_ENABLED_KEY) === "true";
}

export function setWebPushEnabledInSettings(enabled: boolean): void {
  localStorage.setItem(WEB_PUSH_ENABLED_KEY, enabled ? "true" : "false");
}

export function getWebPushSupportStatus(): WebPushStatus {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return "unsupported";
  }
  if (!isWebPushEnabledInSettings()) return "disabled";
  if (Notification.permission === "denied") return "denied";
  return "ready";
}

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(FCM_SW_SCOPE);
  if (existing?.active) return existing;

  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
    scope: FCM_SW_SCOPE,
  });

  await waitForServiceWorkerActive(registration);
  return registration;
}

async function waitForServiceWorkerActive(registration: ServiceWorkerRegistration): Promise<void> {
  if (registration.active) return;

  const worker = registration.installing ?? registration.waiting;
  if (!worker) {
    await navigator.serviceWorker.ready;
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Service worker activation timed out.")), 10000);
    worker.onstatechange = () => {
      if (worker.state === "activated") {
        window.clearTimeout(timeout);
        resolve();
      }
    };
  });
}

/** Standard Web Push subscription JSON — no fcmregistrations.googleapis.com call. */
async function obtainWebPushSubscription(vapidKey: string): Promise<string> {
  if (registrationInFlight) return registrationInFlight;

  registrationInFlight = (async () => {
    const registration = await ensureServiceWorker();
    const trimmedVapid = vapidKey.trim();

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(trimmedVapid),
      });
    }

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.auth || !json.keys?.p256dh) {
      throw new Error("Push subscription is missing required keys.");
    }

    return JSON.stringify(json);
  })();

  try {
    return await registrationInFlight;
  } finally {
    registrationInFlight = null;
  }
}

export async function saveWebPushToken(userId: string, token: string): Promise<void> {
  const deviceId = getOrCreateDeviceId();
  const { error } = await requireSupabase().from("EV_UserPushTokens").upsert(
    {
      user_id: userId,
      token,
      token_type: "web_push",
      platform: "web",
      device_id: deviceId,
      device_name: navigator.userAgent.slice(0, 120),
      is_active: true,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,token" }
  );
  if (error) throw error;
}

export async function deactivateWebPush(userId: string): Promise<void> {
  const deviceId = localStorage.getItem(WEB_PUSH_DEVICE_ID_KEY);
  let query = requireSupabase()
    .from("EV_UserPushTokens")
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .in("token_type", ["web_push", "fcm_web"]);

  if (deviceId) query = query.eq("device_id", deviceId);

  const { error } = await query;
  if (error) throw error;

  const registration = await navigator.serviceWorker.getRegistration(FCM_SW_SCOPE);
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await subscription.unsubscribe();
  }

  setWebPushEnabledInSettings(false);
}

export async function registerWebPush(userId: string): Promise<WebPushRegistrationResult> {
  const vapidKey = await resolveVapidKey();
  if (!vapidKey) {
    return {
      ok: false,
      status: "error",
      message:
        "Set VITE_FIREBASE_VAPID_KEY in .env (Web Push VAPID public key), then restart the dev server.",
    };
  }

  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    return { ok: false, status: "unsupported", message: "This browser does not support web push." };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return {
      ok: false,
      status: "denied",
      message:
        "Notification permission was denied. In Chrome: click the lock icon in the address bar → Site settings → Notifications → Allow, then try again.",
    };
  }

  let subscriptionJson: string;
  try {
    subscriptionJson = await obtainWebPushSubscription(vapidKey.trim());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: "error", message: msg };
  }

  await saveWebPushToken(userId, subscriptionJson);
  setWebPushEnabledInSettings(true);
  return { ok: true, status: "ready", token: subscriptionJson };
}

export function showLocalBrowserNotification(title: string, body: string, url = "/notifications"): void {
  if (typeof window === "undefined" || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;

  const notification = new Notification(title, {
    body,
    icon: "/favicon.svg",
    tag: "ev-cms-foreground",
  });
  notification.onclick = () => {
    window.focus();
    window.location.href = url;
    notification.close();
  };
}

/** Foreground FCM hook — unused for VAPID web push (realtime + SW handle delivery). */
export function subscribeForegroundMessages(
  _onPayload: (payload: MessagePayload) => void
): () => void {
  return () => {};
}
