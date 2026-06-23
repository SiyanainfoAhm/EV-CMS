import { readFirebaseWebConfig } from "@/utils/firebaseWebConfig";

/** Firebase messaging default — see @firebase/messaging DEFAULT_SW_SCOPE */
export const FCM_SW_SCOPE = "/firebase-cloud-messaging-push-scope";

/** Mirrors @firebase/messaging getRegistrationOrigin */
function getRegistrationOrigin(swScope: string, appNameFallback = "web"): string {
  try {
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(swScope)) {
      return new URL(swScope).host;
    }
  } catch {
    // fall through
  }
  try {
    if (typeof window !== "undefined" && window.location?.href) {
      return new URL(swScope, window.location.origin).host;
    }
  } catch {
    // fall through
  }
  if (typeof window !== "undefined" && window.location?.host) {
    return window.location.host;
  }
  return appNameFallback;
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

/** Matches @firebase/messaging arrayToBase64 */
function arrayToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) throw new Error("Missing push subscription key.");
  const uint8Array = new Uint8Array(buffer);
  const base64String = btoa(String.fromCharCode(...uint8Array));
  return base64String.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function assertInstallationAuthToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed.startsWith("eyJ")) {
    throw new Error(
      "Firebase installation auth token is invalid. In Google Cloud → Credentials → Browser key, set API restrictions to Don't restrict key (or allow Firebase Installations API + FCM Registration API)."
    );
  }
  return trimmed;
}

/**
 * Direct FCM registration — mirrors @firebase/messaging requestGetToken headers/body.
 */
export async function registerFcmTokenManually(
  installationAuthToken: string,
  vapidKey: string,
  serviceWorkerRegistration: ServiceWorkerRegistration
): Promise<string> {
  const config = readFirebaseWebConfig();
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY?.trim() || config?.apiKey || "";
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() || config?.projectId || "";

  if (!apiKey || !projectId) {
    throw new Error("Firebase web config is incomplete (apiKey / projectId).");
  }

  const installationToken = assertInstallationAuthToken(installationAuthToken);
  const trimmedVapid = vapidKey.trim();

  let subscription = await serviceWorkerRegistration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await serviceWorkerRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(trimmedVapid),
    });
  }

  const body = {
    web: {
      origin: getRegistrationOrigin(serviceWorkerRegistration.scope),
      endpoint: subscription.endpoint,
      auth: arrayToBase64(subscription.getKey("auth")),
      p256dh: arrayToBase64(subscription.getKey("p256dh")),
      applicationPubKey: trimmedVapid,
    },
  };

  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-goog-api-key": apiKey,
    "x-goog-firebase-installations-auth": `FIS ${installationToken}`,
  };

  if (import.meta.env.DEV) {
    console.info("[fcm] registering with headers", {
      hasApiKey: Boolean(requestHeaders["x-goog-api-key"]),
      hasFisAuth: requestHeaders["x-goog-firebase-installations-auth"].startsWith("FIS eyJ"),
      projectId,
    });
  }

  const response = await fetch(
    `https://fcmregistrations.googleapis.com/v1/projects/${projectId}/registrations`,
    {
      method: "POST",
      mode: "cors",
      headers: requestHeaders,
      body: JSON.stringify(body),
    }
  );

  const payload = (await response.json()) as {
    token?: string;
    error?: {
      message?: string;
      status?: string;
      details?: Array<{ reason?: string; metadata?: { service?: string } }>;
    };
  };
  if (!response.ok) {
    const blockedService = payload.error?.details?.find((d) => d.reason === "API_KEY_SERVICE_BLOCKED")
      ?.metadata?.service;

    if (import.meta.env.DEV && response.status === 401) {
      console.error("[fcm] 401 on registrations — auth headers were sent. Likely API key restriction.", {
        apiKeyPrefix: requestHeaders["x-goog-api-key"]?.slice(0, 12),
        blockedService,
        projectId,
      });
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        blockedService === "fcmregistrations.googleapis.com" || response.status === 401
          ? [
              "FCM Registration API rejected the Browser API key.",
              "Google Cloud → APIs & Services → Credentials → key AIzaSyDdg… → API restrictions:",
              "add FCM Registration API (fcmregistrations.googleapis.com) and Firebase Installations API.",
              "For dev you can set Don't restrict key. Wait 2–5 minutes after saving, then retry.",
            ].join(" ")
          : (payload.error?.message ?? `FCM registration failed (${response.status}).`)
      );
    }

    throw new Error(payload.error?.message ?? `FCM registration failed (${response.status}).`);
  }

  if (!payload.token) {
    throw new Error("FCM registration succeeded but no token was returned.");
  }

  return payload.token;
}
