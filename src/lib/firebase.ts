import { initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";
import { getMessaging, isSupported as isMessagingSupported, type Messaging } from "firebase/messaging";

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

function readFirebaseConfig(): FirebaseWebConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY?.trim();
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim();
  const storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim();
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim();
  const appId = import.meta.env.VITE_FIREBASE_APP_ID?.trim();
  const measurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID?.trim();

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
  };
}

let firebaseApp: FirebaseApp | null = null;
let analyticsInstance: Analytics | null = null;
let messagingInstance: Messaging | null = null;

/** Firebase web app — DFCCIL EV CMS Admin (project: dffcilevcms). */
export function getFirebaseApp(): FirebaseApp | null {
  if (firebaseApp) return firebaseApp;

  const config = readFirebaseConfig();
  if (!config) return null;

  const options: FirebaseOptions = {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
    measurementId: config.measurementId,
  };

  firebaseApp = initializeApp(options);
  return firebaseApp;
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
