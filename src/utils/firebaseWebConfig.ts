export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
  vapidKey?: string;
}

export function readFirebaseWebConfig(): FirebaseWebConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY?.trim();
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim();
  const storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim();
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim();
  const appId = import.meta.env.VITE_FIREBASE_APP_ID?.trim();
  const measurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID?.trim();
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY?.trim();

  if (!apiKey || !authDomain || !projectId || !storageBucket || !messagingSenderId || !appId) {
    return null;
  }

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
    measurementId: measurementId || undefined,
    vapidKey: vapidKey || undefined,
  };
}

let cachedRemoteVapidKey: string | null | undefined;

export function isWebPushConfigured(): boolean {
  const config = readFirebaseWebConfig();
  return Boolean(config?.vapidKey);
}

/** Loads VAPID from .env, then Supabase public config (firebase_vapid_public_key). */
export async function resolveVapidKey(): Promise<string | undefined> {
  const envKey = import.meta.env.VITE_FIREBASE_VAPID_KEY?.trim();
  if (envKey) return envKey;

  if (cachedRemoteVapidKey !== undefined) {
    return cachedRemoteVapidKey ?? undefined;
  }

  try {
    const { requireSupabase } = await import("@/utils/supabaseClient");
    const { data, error } = await requireSupabase().rpc("ev_get_public_config", {
      p_key: "firebase_vapid_public_key",
    });
    if (!error && typeof data === "string" && data.trim()) {
      cachedRemoteVapidKey = data.trim();
      return cachedRemoteVapidKey;
    }
  } catch {
    // ignore — fall through
  }

  cachedRemoteVapidKey = null;
  return undefined;
}

export async function isWebPushConfiguredAsync(): Promise<boolean> {
  if (isWebPushConfigured()) return true;
  const key = await resolveVapidKey();
  return Boolean(key);
}
