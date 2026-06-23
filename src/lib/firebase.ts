import "firebase/installations";
import { deleteApp, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";
import { getMessaging, isSupported as isMessagingSupported, type Messaging } from "firebase/messaging";
import { readFirebaseWebConfig } from "@/utils/firebaseWebConfig";

let firebaseApp: FirebaseApp | null = null;
let analyticsInstance: Analytics | null = null;
let messagingInstance: Messaging | null = null;

function buildFirebaseOptions(): FirebaseOptions | null {
  const config = readFirebaseWebConfig();
  if (!config) return null;

  return {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
    measurementId: config.measurementId,
  };
}

/** Firebase web app — DFCCIL EV CMS Admin (project: dffcilevcms). */
export function getFirebaseApp(): FirebaseApp | null {
  if (firebaseApp) return firebaseApp;

  const options = buildFirebaseOptions();
  if (!options) return null;

  firebaseApp = initializeApp(options);
  return firebaseApp;
}

export async function resetFirebaseClients(): Promise<void> {
  messagingInstance = null;
  analyticsInstance = null;

  if (!firebaseApp) return;

  const app = firebaseApp;
  firebaseApp = null;
  await deleteApp(app);
}

export function getFirebaseAnalytics(): Analytics | null {
  return analyticsInstance;
}

export async function getFirebaseMessaging(): Promise<Messaging | null> {
  if (messagingInstance) return messagingInstance;

  const app = getFirebaseApp();
  if (!app || typeof window === "undefined") return null;

  const supported = await isMessagingSupported();
  if (!supported) return null;

  messagingInstance = getMessaging(app);
  return messagingInstance;
}

/**
 * Call once at app startup (see main.tsx).
 * Analytics runs in production only; messaging is loaded on demand later.
 */
export async function initFirebase(): Promise<void> {
  const app = getFirebaseApp();
  if (!app) {
    if (import.meta.env.DEV) {
      console.warn("[firebase] Skipped — set VITE_FIREBASE_* variables in .env");
    }
    return;
  }

  if (typeof window === "undefined") return;

  try {
    const analyticsSupported = await isSupported();
    if (analyticsSupported && import.meta.env.PROD) {
      analyticsInstance = getAnalytics(app);
    }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("[firebase] Analytics init failed:", err);
    }
  }
}
