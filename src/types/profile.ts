import type { UserRole } from "@/types/auth";

export interface NotificationPreferences {
  chargerOffline: boolean;
  chargerFaulted: boolean;
  sessionStarted: boolean;
  sessionStopped: boolean;
  paymentReceived: boolean;
  firmwareAvailable: boolean;
  weeklyReport: boolean;
  emailDigest: boolean;
}

export interface SystemPreferences {
  sessionTimeout: number;
  autoRefreshInterval: number;
  dateFormat: string;
  timeFormat: string;
  energyUnit: string;
  currency: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: string;
  authRole: UserRole;
  department: string;
  status: string;
  phone: string;
  avatarUrl: string | null;
  employeeId: string | null;
  lastLoginAt: string | null;
  joinedAt: string;
  notifications: NotificationPreferences;
  systemSettings: SystemPreferences;
}

export interface LoginHistoryEntry {
  id: string;
  action: string;
  details: string;
  ipAddress: string | null;
  createdAt: string;
}

export const DEFAULT_NOTIFICATIONS: NotificationPreferences = {
  chargerOffline: true,
  chargerFaulted: true,
  sessionStarted: false,
  sessionStopped: false,
  paymentReceived: true,
  firmwareAvailable: true,
  weeklyReport: true,
  emailDigest: false,
};

export const DEFAULT_SYSTEM_SETTINGS: SystemPreferences = {
  sessionTimeout: 30,
  autoRefreshInterval: 15,
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  energyUnit: "kWh",
  currency: "INR",
};
