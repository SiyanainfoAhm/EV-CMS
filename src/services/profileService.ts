import type {
  LoginHistoryEntry,
  NotificationPreferences,
  SystemPreferences,
  UserProfile,
} from "@/types/profile";
import { requireSupabase } from "@/utils/supabaseClient";
import { mapDbRoleToAuthRole, mapDisplayRole } from "@/utils/supabaseMappers";

function mapNotifications(raw: unknown): NotificationPreferences {
  const d = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, boolean>;
  return {
    chargerOffline: d.chargerOffline ?? true,
    chargerFaulted: d.chargerFaulted ?? true,
    sessionStarted: d.sessionStarted ?? false,
    sessionStopped: d.sessionStopped ?? false,
    paymentReceived: d.paymentReceived ?? true,
    firmwareAvailable: d.firmwareAvailable ?? true,
    weeklyReport: d.weeklyReport ?? true,
    emailDigest: d.emailDigest ?? false,
  };
}

function mapSystemSettings(raw: unknown): SystemPreferences {
  const d = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    sessionTimeout: Number(d.sessionTimeout ?? 30),
    autoRefreshInterval: Number(d.autoRefreshInterval ?? 15),
    dateFormat: (d.dateFormat as string) ?? "DD/MM/YYYY",
    timeFormat: (d.timeFormat as string) ?? "24h",
    energyUnit: (d.energyUnit as string) ?? "kWh",
    currency: (d.currency as string) ?? "INR",
  };
}

function mapProfileRow(row: Record<string, unknown>): UserProfile {
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.full_name as string,
    role: mapDisplayRole(row.role as string),
    authRole: mapDbRoleToAuthRole(row.role as string),
    department: (row.department as string) ?? "",
    status: row.status as string,
    phone: (row.phone as string) ?? "",
    avatarUrl: (row.avatar_url as string) ?? null,
    employeeId: (row.employee_id as string) ?? null,
    lastLoginAt: (row.last_login_at as string) ?? null,
    joinedAt: row.created_at as string,
    notifications: mapNotifications(row.notifications),
    systemSettings: mapSystemSettings(row.system_settings),
  };
}

export async function getProfile(userId: string): Promise<UserProfile> {
  const { data, error } = await requireSupabase().rpc("get_ev_user_profile", {
    p_user_id: userId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Profile not found");
  return mapProfileRow(row as Record<string, unknown>);
}

export async function updateProfile(
  userId: string,
  input: {
    name: string;
    email: string;
    phone?: string;
    department?: string;
    avatarUrl?: string | null;
  }
): Promise<void> {
  const { error } = await requireSupabase().rpc("update_ev_user_profile", {
    p_user_id: userId,
    p_full_name: input.name,
    p_email: input.email,
    p_phone: input.phone ?? null,
    p_department: input.department ?? null,
    p_avatar_url: input.avatarUrl ?? null,
  });
  if (error) throw error;
}

export async function savePreferences(
  userId: string,
  notifications: NotificationPreferences,
  systemSettings: SystemPreferences
): Promise<void> {
  const { error } = await requireSupabase().rpc("upsert_ev_user_preferences", {
    p_user_id: userId,
    p_notifications: notifications,
    p_system_settings: systemSettings,
  });
  if (error) throw error;
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<boolean> {
  const { data, error } = await requireSupabase().rpc("change_ev_user_password", {
    p_user_id: userId,
    p_current_password: currentPassword,
    p_new_password: newPassword,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function createEmailChangeOtp(userId: string, newEmail: string): Promise<string> {
  const { data, error } = await requireSupabase().rpc("create_ev_email_change_otp", {
    p_user_id: userId,
    p_new_email: newEmail.trim(),
  });
  if (error) {
    const msg = error.message ?? "Failed to create verification code";
    if (msg.includes("already in use")) {
      throw new Error("This email is already used by another account");
    }
    if (msg.includes("create_ev_email_change_otp")) {
      throw new Error("Run supabase/email_change_otp.sql on Supabase to enable email verification");
    }
    throw new Error(msg);
  }
  const otp = String(data ?? "").trim();
  if (!/^\d{6}$/.test(otp)) {
    throw new Error("Invalid verification code from server");
  }
  return otp;
}

export async function verifyEmailChangeOtp(
  userId: string,
  newEmail: string,
  otp: string
): Promise<boolean> {
  const { data, error } = await requireSupabase().rpc("verify_ev_email_change_otp", {
    p_user_id: userId,
    p_new_email: newEmail.trim(),
    p_otp: otp.trim(),
  });
  if (error) {
    if (error.message?.includes("verify_ev_email_change_otp")) {
      throw new Error("Run supabase/email_change_otp.sql on Supabase to enable email verification");
    }
    throw error;
  }
  return Boolean(data);
}

export async function recordLoginAttempt(
  email: string,
  success: boolean,
  details?: string
): Promise<void> {
  const { error } = await requireSupabase().rpc("record_ev_login_attempt", {
    p_email: email,
    p_success: success,
    p_details: details ?? null,
  });
  if (error) {
    console.warn("[profileService] record_ev_login_attempt:", error.message);
  }
}

export async function getLoginHistory(userId: string): Promise<LoginHistoryEntry[]> {
  const { data, error } = await requireSupabase().rpc("get_ev_login_history", {
    p_user_id: userId,
    p_limit: 20,
  });
  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? []).map((row) => ({
    id: row.id as string,
    action: row.action as string,
    details: (row.details as string) ?? "",
    ipAddress: (row.ip_address as string) ?? null,
    createdAt: row.created_at as string,
  }));
}

export function profileToAuthFields(profile: UserProfile) {
  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    role: profile.authRole,
    department: profile.department,
    status: profile.status as "active" | "inactive" | "suspended",
    phone: profile.phone,
    avatarUrl: profile.avatarUrl,
    employeeId: profile.employeeId,
  };
}
