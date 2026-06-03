import AsyncStorage from "@react-native-async-storage/async-storage";
import type { User } from "../types";

const TOKEN_KEY = "ev_cms_mobile_token";
const USER_KEY = "ev_cms_mobile_user";
const EXPIRES_KEY = "ev_cms_mobile_expires";

export interface StoredSession {
  token: string;
  user: User;
  expiresAt: string;
}

export async function loadStoredSession(): Promise<StoredSession | null> {
  const [token, userJson, expiresAt] = await Promise.all([
    AsyncStorage.getItem(TOKEN_KEY),
    AsyncStorage.getItem(USER_KEY),
    AsyncStorage.getItem(EXPIRES_KEY),
  ]);
  if (!token || !userJson) return null;
  try {
    const user = JSON.parse(userJson) as User;
    return { token, user, expiresAt: expiresAt ?? "" };
  } catch {
    return null;
  }
}

export async function saveStoredSession(session: StoredSession): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(TOKEN_KEY, session.token),
    AsyncStorage.setItem(USER_KEY, JSON.stringify(session.user)),
    AsyncStorage.setItem(EXPIRES_KEY, session.expiresAt),
  ]);
}

export async function clearStoredSession(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(TOKEN_KEY),
    AsyncStorage.removeItem(USER_KEY),
    AsyncStorage.removeItem(EXPIRES_KEY),
  ]);
}
