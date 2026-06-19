import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/hooks/useAuth";
import * as profileService from "@/services/profileService";
import {
  DEFAULT_NOTIFICATIONS,
  DEFAULT_SYSTEM_SETTINGS,
  type NotificationPreferences,
  type SystemPreferences,
} from "@/types/profile";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatEnergy,
} from "@/utils/formatPreferences";
import {
  applySystemSettings,
  cachePreferences,
  loadCachedPreferences,
  notifyPreferencesUpdated,
} from "@/utils/userPreferencesStore";

interface UserPreferencesContextValue {
  loaded: boolean;
  notifications: NotificationPreferences;
  systemSettings: SystemPreferences;
  setNotifications: (next: NotificationPreferences) => void;
  setSystemSettings: (next: SystemPreferences) => void;
  savePreferences: (
    nextNotifications?: NotificationPreferences,
    nextSystem?: SystemPreferences
  ) => Promise<void>;
  formatDate: (iso: string | Date | null | undefined) => string;
  formatDateTime: (iso: string | Date | null | undefined) => string;
  formatCurrency: (amount: number) => string;
  formatEnergy: (kwh: number) => string;
}

const UserPreferencesContext = createContext<UserPreferencesContextValue | null>(null);

export function UserPreferencesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [loaded, setLoaded] = useState(false);
  const [notifications, setNotifications] = useState<NotificationPreferences>(DEFAULT_NOTIFICATIONS);
  const [systemSettings, setSystemSettings] = useState<SystemPreferences>(DEFAULT_SYSTEM_SETTINGS);

  useEffect(() => {
    if (!userId) {
      setNotifications(DEFAULT_NOTIFICATIONS);
      setSystemSettings(DEFAULT_SYSTEM_SETTINGS);
      setLoaded(false);
      return;
    }

    const cached = loadCachedPreferences(userId);
    if (cached) {
      setNotifications(cached.notifications);
      setSystemSettings(cached.systemSettings);
      applySystemSettings(cached.systemSettings);
    }

    let cancelled = false;
    profileService
      .getProfile(userId)
      .then((profile) => {
        if (cancelled) return;
        setNotifications(profile.notifications);
        setSystemSettings(profile.systemSettings);
        cachePreferences(userId, profile.notifications, profile.systemSettings);
        applySystemSettings(profile.systemSettings);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const savePreferences = useCallback(
    async (
      nextNotifications = notifications,
      nextSystem = systemSettings
    ) => {
      if (!userId) return;
      await profileService.savePreferences(userId, nextNotifications, nextSystem);
      setNotifications(nextNotifications);
      setSystemSettings(nextSystem);
      cachePreferences(userId, nextNotifications, nextSystem);
      applySystemSettings(nextSystem);
      notifyPreferencesUpdated();
    },
    [userId, notifications, systemSettings]
  );

  const value = useMemo<UserPreferencesContextValue>(
    () => ({
      loaded,
      notifications,
      systemSettings,
      setNotifications,
      setSystemSettings,
      savePreferences,
      formatDate: (iso) => formatDate(iso, systemSettings),
      formatDateTime: (iso) => formatDateTime(iso, systemSettings),
      formatCurrency: (amount) => formatCurrency(amount, systemSettings),
      formatEnergy: (kwh) => formatEnergy(kwh, systemSettings),
    }),
    [loaded, notifications, systemSettings, savePreferences]
  );

  return (
    <UserPreferencesContext.Provider value={value}>{children}</UserPreferencesContext.Provider>
  );
}

export function useUserPreferences(): UserPreferencesContextValue {
  const ctx = useContext(UserPreferencesContext);
  if (!ctx) {
    throw new Error("useUserPreferences must be used within UserPreferencesProvider");
  }
  return ctx;
}
