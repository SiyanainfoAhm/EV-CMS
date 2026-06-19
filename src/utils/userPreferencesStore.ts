import {
  DEFAULT_NOTIFICATIONS,
  DEFAULT_SYSTEM_SETTINGS,
  type NotificationPreferences,
  type SystemPreferences,
} from "@/types/profile";
import { setIdleTimeoutMinutes } from "@/hooks/useInactivityLogout";

export const PREFERENCES_UPDATED_EVENT = "ev-cms-preferences-updated";

function cacheKey(userId: string): string {
  return `ev_cms_prefs_${userId}`;
}

export function loadCachedPreferences(userId: string): {
  notifications: NotificationPreferences;
  systemSettings: SystemPreferences;
} | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      notifications?: NotificationPreferences;
      systemSettings?: SystemPreferences;
    };
    return {
      notifications: { ...DEFAULT_NOTIFICATIONS, ...parsed.notifications },
      systemSettings: { ...DEFAULT_SYSTEM_SETTINGS, ...parsed.systemSettings },
    };
  } catch {
    return null;
  }
}

export function cachePreferences(
  userId: string,
  notifications: NotificationPreferences,
  systemSettings: SystemPreferences
): void {
  try {
    localStorage.setItem(
      cacheKey(userId),
      JSON.stringify({ notifications, systemSettings })
    );
  } catch {
    /* ignore */
  }
}

export function applySystemSettings(settings: SystemPreferences): void {
  setIdleTimeoutMinutes(settings.sessionTimeout);
  window.dispatchEvent(
    new CustomEvent(PREFERENCES_UPDATED_EVENT, { detail: { systemSettings: settings } })
  );
}

export function notifyPreferencesUpdated(): void {
  window.dispatchEvent(new CustomEvent(PREFERENCES_UPDATED_EVENT));
}
