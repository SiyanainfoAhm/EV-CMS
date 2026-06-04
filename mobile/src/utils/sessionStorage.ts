import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import type { User } from "../types";

const TOKEN_KEY = "ev_cms_mobile_token";
const USER_KEY = "ev_cms_mobile_user";
const EXPIRES_KEY = "ev_cms_mobile_expires";

const isWeb = Platform.OS === "web";

function webGet(key: string): string | null {
  if (!isWeb || typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function webSet(key: string, value: string): void {
  if (!isWeb || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota / private mode */
  }
}

function webRemove(key: string): void {
  if (!isWeb || typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export interface StoredSession {
  token: string;
  user: User;
  expiresAt: string;
}

export async function loadStoredSession(): Promise<StoredSession | null> {
  let token = await AsyncStorage.getItem(TOKEN_KEY);
  let userJson = await AsyncStorage.getItem(USER_KEY);
  let expiresAt = await AsyncStorage.getItem(EXPIRES_KEY);

  if (isWeb && (!token || !userJson)) {
    token = token ?? webGet(TOKEN_KEY);
    userJson = userJson ?? webGet(USER_KEY);
    expiresAt = expiresAt ?? webGet(EXPIRES_KEY);
  }

  if (!token || !userJson || !token.startsWith("ev_mobile_")) return null;
  try {
    const user = JSON.parse(userJson) as User;
    if (!user?.id) return null;
    return { token, user, expiresAt: expiresAt ?? "" };
  } catch {
    return null;
  }
}

export async function saveStoredSession(session: StoredSession): Promise<void> {
  const userJson = JSON.stringify(session.user);
  await Promise.all([
    AsyncStorage.setItem(TOKEN_KEY, session.token),
    AsyncStorage.setItem(USER_KEY, userJson),
    AsyncStorage.setItem(EXPIRES_KEY, session.expiresAt),
  ]);
  if (isWeb) {
    webSet(TOKEN_KEY, session.token);
    webSet(USER_KEY, userJson);
    webSet(EXPIRES_KEY, session.expiresAt);
  }
}

export async function clearStoredSession(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(TOKEN_KEY),
    AsyncStorage.removeItem(USER_KEY),
    AsyncStorage.removeItem(EXPIRES_KEY),
  ]);
  if (isWeb) {
    webRemove(TOKEN_KEY);
    webRemove(USER_KEY);
    webRemove(EXPIRES_KEY);
  }
}
