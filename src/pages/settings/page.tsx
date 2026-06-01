import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import * as profileService from "@/services/profileService";
import * as mediaService from "@/services/mediaService";
import { formatLastLogin } from "@/utils/supabaseMappers";
import type { NotificationPreferences, SystemPreferences } from "@/types/profile";
import { FormField, inputClassName } from "@/components/ui/FormField";
import {
  hasErrors,
  validatePasswordChange,
  validateProfileForm,
} from "@/utils/validation";

interface ProfileForm {
  name: string;
  email: string;
  department: string;
  phone: string;
}

interface PasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

function formatJoined(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const userId = user?.id ?? "";
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: profile, reload: reloadProfile } = useAsyncData(
    () => (userId ? profileService.getProfile(userId) : Promise.resolve(null)),
    [userId]
  );
  const { data: loginHistory, reload: reloadLoginHistory } = useAsyncData(
    () => (userId ? profileService.getLoginHistory(userId) : Promise.resolve([])),
    [userId]
  );
  const [profileErrors, setProfileErrors] = useState<Partial<Record<keyof ProfileForm, string>>>({});
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"profile" | "security" | "notifications" | "system">("profile");
  const [profileForm, setProfileForm] = useState<ProfileForm>({
    name: "",
    email: "",
    department: "IT",
    phone: "",
  });
  const [passwordForm, setPasswordForm] = useState<PasswordForm>({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [notifications, setNotifications] = useState<NotificationPreferences>({
    chargerOffline: true,
    chargerFaulted: true,
    sessionStarted: false,
    sessionStopped: false,
    paymentReceived: true,
    firmwareAvailable: true,
    weeklyReport: true,
    emailDigest: false,
  });
  const [systemSettings, setSystemSettings] = useState<SystemPreferences>({
    sessionTimeout: 30,
    autoRefreshInterval: 15,
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24h",
    energyUnit: "kWh",
    currency: "INR",
  });
  const [toast, setToast] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (activeTab === "security" && userId) {
      reloadLoginHistory();
    }
  }, [activeTab, userId, reloadLoginHistory]);

  useEffect(() => {
    if (!profile) return;
    setProfileForm({
      name: profile.name,
      email: profile.email,
      department: profile.department || "IT",
      phone: profile.phone || "",
    });
    setNotifications(profile.notifications);
    setSystemSettings(profile.systemSettings);
    setAvatarUrl(profile.avatarUrl);
  }, [profile]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleProfileSave = async () => {
    if (!userId) return;
    const errors = validateProfileForm(profileForm);
    setProfileErrors(errors);
    if (hasErrors(errors)) return;
    setSaving(true);
    try {
      await profileService.updateProfile(userId, {
        name: profileForm.name,
        email: profileForm.email,
        phone: profileForm.phone,
        department: profileForm.department,
        avatarUrl,
      });
      await refreshUser();
      await reloadProfile();
      showToast("Profile updated successfully");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    setUploading(true);
    try {
      const url = await mediaService.uploadUserAvatar(userId, file);
      setAvatarUrl(url);
      await profileService.updateProfile(userId, {
        name: profileForm.name || profile?.name || "",
        email: profileForm.email || profile?.email || "",
        phone: profileForm.phone,
        department: profileForm.department,
        avatarUrl: url,
      });
      await refreshUser();
      showToast("Photo updated");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handlePasswordChange = async () => {
    if (!userId) return;
    const pwdErr = validatePasswordChange(
      passwordForm.currentPassword,
      passwordForm.newPassword,
      passwordForm.confirmPassword
    );
    setPasswordError(pwdErr);
    if (pwdErr) return;
    setSaving(true);
    try {
      const ok = await profileService.changePassword(
        userId,
        passwordForm.currentPassword,
        passwordForm.newPassword
      );
      if (!ok) {
        showToast("Current password is incorrect");
        return;
      }
      showToast("Password changed successfully");
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordError(null);
      await reloadLoginHistory();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Password change failed");
    } finally {
      setSaving(false);
    }
  };

  const persistPreferences = async (
    nextNotifications = notifications,
    nextSystem = systemSettings
  ) => {
    if (!userId) return;
    await profileService.savePreferences(userId, nextNotifications, nextSystem);
  };

  const toggleNotification = async (key: keyof NotificationPreferences) => {
    const next = { ...notifications, [key]: !notifications[key] };
    setNotifications(next);
    try {
      await persistPreferences(next, systemSettings);
    } catch {
      setNotifications(notifications);
      showToast("Could not save notification preference");
    }
  };

  const handleSystemSave = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      await persistPreferences(notifications, systemSettings);
      showToast("System settings saved");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const displayName = profile?.name ?? user?.name ?? "—";
  const displayRole = profile?.role ?? user?.role ?? "—";
  const employeeId = profile?.employeeId ?? user?.employeeId ?? "—";
  const joined = profile?.joinedAt ? formatJoined(profile.joinedAt) : "—";
  const lastLogin = profile?.lastLoginAt
    ? formatLastLogin(profile.lastLoginAt)
    : user
      ? "—"
      : "—";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const tabs = [
    { key: "profile" as const, label: "Profile", icon: "ri-user-settings-line" },
    { key: "security" as const, label: "Security", icon: "ri-shield-check-line" },
    { key: "notifications" as const, label: "Notifications", icon: "ri-notification-3-line" },
    { key: "system" as const, label: "System", icon: "ri-settings-3-line" },
  ];

  return (
    <div className="space-y-5">
      {toast && (
        <div className="fixed top-20 right-6 z-50 px-4 py-2.5 bg-gray-900 text-white rounded-lg text-sm shadow-lg animate-pulse">
          {toast}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'DM Sans', sans-serif" }}>
          Settings &amp; Profile
        </h1>
        <p className="text-sm text-gray-500 mt-1">Manage your account, security, and system preferences</p>
      </div>

      <div className="flex items-center gap-1 bg-white rounded-xl border border-gray-200 p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-2 ${
              activeTab === tab.key ? "bg-emerald-600 text-white" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <div className="w-4 h-4 flex items-center justify-center">
              <i className={tab.icon}></i>
            </div>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "profile" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
              <div className="w-24 h-24 rounded-full overflow-hidden mx-auto mb-4 border-4 border-emerald-100 bg-emerald-50 flex items-center justify-center">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Profile"
                    className="w-full h-full object-cover object-top"
                  />
                ) : (
                  <span className="text-2xl font-semibold text-emerald-700">{initials}</span>
                )}
              </div>
              <h3 className="text-base font-semibold text-gray-900">{displayName}</h3>
              <p className="text-sm text-gray-500">{displayRole}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                DFCCIL {profileForm.department || profile?.department || ""} Department
              </p>

              <div className="mt-5 pt-5 border-t border-gray-100 space-y-2 text-left">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Employee ID</span>
                  <span className="text-xs font-medium text-gray-700">{employeeId}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Role</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-rose-100 text-rose-700">
                    {displayRole}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Joined</span>
                  <span className="text-xs font-medium text-gray-700">{joined}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Last Login</span>
                  <span className="text-xs font-medium text-gray-700">{lastLogin}</span>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="mt-5 w-full px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-500 hover:bg-gray-50 transition-colors whitespace-nowrap disabled:opacity-50"
              >
                {uploading ? "Uploading…" : "Change Photo"}
              </button>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-5">Personal Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Full Name" error={profileErrors.name} required>
                  <input
                    type="text"
                    value={profileForm.name}
                    onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                    className={inputClassName(!!profileErrors.name)}
                  />
                </FormField>
                <FormField label="Email Address" error={profileErrors.email} required>
                  <input
                    type="email"
                    value={profileForm.email}
                    onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                    className={inputClassName(!!profileErrors.email)}
                  />
                </FormField>
                <FormField label="Department" error={profileErrors.department} required>
                  <select
                    value={profileForm.department}
                    onChange={(e) => setProfileForm({ ...profileForm, department: e.target.value })}
                    className={inputClassName(!!profileErrors.department)}
                  >
                    <option value="IT">IT</option>
                    <option value="Operations">Operations</option>
                    <option value="Logistics">Logistics</option>
                    <option value="Management">Management</option>
                  </select>
                </FormField>
                <FormField label="Phone Number" error={profileErrors.phone}>
                  <input
                    type="tel"
                    value={profileForm.phone}
                    onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                    className={inputClassName(!!profileErrors.phone)}
                    placeholder="+91 98765 43210"
                  />
                </FormField>
              </div>
              <div className="mt-6 flex items-center gap-3">
                <button
                  onClick={handleProfileSave}
                  disabled={saving || !userId}
                  className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save Changes"}
                </button>
                <button className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors whitespace-nowrap">
                  Cancel
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6 mt-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-5">Account Activity</h3>
              <div className="space-y-3">
                {(loginHistory ?? []).length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">No login history yet</p>
                ) : (
                  (loginHistory ?? []).map((entry, idx) => {
                    const isSuccess = entry.action === "login";
                    const time = formatLastLogin(entry.createdAt);
                    return (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0"
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 flex-shrink-0 mt-0.5">
                            <i
                              className={`text-sm ${
                                isSuccess ? "ri-login-circle-line text-emerald-600" : "ri-error-warning-line text-red-500"
                              }`}
                            ></i>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-gray-900">
                                {isSuccess ? "Successful login" : "Failed login attempt"}
                              </p>
                              {idx === 0 && isSuccess && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium whitespace-nowrap">
                                  Latest
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {entry.details || "—"}
                              {entry.ipAddress ? ` · IP: ${entry.ipAddress}` : ""}
                            </p>
                            <p className="text-xs text-gray-300">{time}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "security" && (
        <div className="max-w-2xl space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-5">Change Password</h3>
            {passwordError && (
              <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {passwordError}
              </p>
            )}
            <div className="space-y-4">
              <FormField label="Current Password" required>
                <input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => {
                    setPasswordForm({ ...passwordForm, currentPassword: e.target.value });
                    if (passwordError) setPasswordError(null);
                  }}
                  className={inputClassName(!!passwordError)}
                  placeholder="Enter current password"
                  autoComplete="current-password"
                />
              </FormField>
              <FormField label="New Password" required>
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => {
                    setPasswordForm({ ...passwordForm, newPassword: e.target.value });
                    if (passwordError) setPasswordError(null);
                  }}
                  className={inputClassName(!!passwordError)}
                  placeholder="Min. 8 chars, letter + number"
                  autoComplete="new-password"
                />
              </FormField>
              <FormField label="Confirm New Password" required>
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => {
                    setPasswordForm({ ...passwordForm, confirmPassword: e.target.value });
                    if (passwordError) setPasswordError(null);
                  }}
                  className={inputClassName(!!passwordError)}
                  placeholder="Re-enter new password"
                  autoComplete="new-password"
                />
              </FormField>
            </div>
            <div className="mt-6">
              <button
                onClick={handlePasswordChange}
                className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors whitespace-nowrap"
              >
                Update Password
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-5">Two-Factor Authentication</h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">2FA Status</p>
                <p className="text-xs text-gray-400 mt-0.5">Add an extra layer of security to your account</p>
              </div>
              <span className="text-xs px-3 py-1 rounded-full font-medium bg-red-100 text-red-700">Disabled</span>
            </div>
            <button className="mt-4 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap">
              Enable 2FA
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Login History</h3>
            <div className="space-y-2">
              {(loginHistory ?? []).length === 0 ? (
                <p className="text-sm text-gray-400 py-2">No login history recorded</p>
              ) : (
                (loginHistory ?? []).map((entry) => {
                  const isSuccess = entry.action === "login";
                  return (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            isSuccess ? "bg-emerald-500" : "bg-red-500"
                          }`}
                        ></div>
                        <span className="text-sm text-gray-700">{formatLastLogin(entry.createdAt)}</span>
                      </div>
                      <span className="text-xs text-gray-400">
                        {entry.ipAddress ? `IP: ${entry.ipAddress}` : entry.details || "—"}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "notifications" && (
        <div className="max-w-2xl space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-5">Charger Alerts</h3>
            <div className="space-y-4">
              {[
                { key: "chargerOffline" as const, label: "Charger goes offline", desc: "Get notified when any charger loses connectivity" },
                { key: "chargerFaulted" as const, label: "Charger fault detected", desc: "Alert when a charger reports a fault condition" },
                { key: "sessionStarted" as const, label: "New session started", desc: "Notification when a charging session begins on any charger" },
                { key: "sessionStopped" as const, label: "Session stopped", desc: "Alert when a charging session ends or is stopped" },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{item.desc}</p>
                  </div>
                  <button
                    onClick={() => toggleNotification(item.key)}
                    className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
                      notifications[item.key] ? "bg-emerald-500" : "bg-gray-300"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        notifications[item.key] ? "left-5" : "left-0.5"
                      }`}
                    ></span>
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-5">Financial &amp; Reports</h3>
            <div className="space-y-4">
              {[
                { key: "paymentReceived" as const, label: "Payment received", desc: "Notify when a charging payment is successfully captured" },
                { key: "firmwareAvailable" as const, label: "Firmware update available", desc: "Alert when new firmware is available for chargers" },
                { key: "weeklyReport" as const, label: "Weekly summary report", desc: "Receive a weekly digest of charger usage and revenue" },
                { key: "emailDigest" as const, label: "Daily email digest", desc: "Get a daily summary email of all charging activity" },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{item.desc}</p>
                  </div>
                  <button
                    onClick={() => toggleNotification(item.key)}
                    className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
                      notifications[item.key] ? "bg-emerald-500" : "bg-gray-300"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        notifications[item.key] ? "left-5" : "left-0.5"
                      }`}
                    ></span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === "system" && (
        <div className="max-w-2xl space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-5">Display Preferences</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">Session Timeout</p>
                  <p className="text-xs text-gray-400 mt-0.5">Auto logout after inactivity</p>
                </div>
                <select
                  value={systemSettings.sessionTimeout}
                  onChange={(e) => setSystemSettings({ ...systemSettings, sessionTimeout: parseInt(e.target.value) })}
                  className="px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={120}>2 hours</option>
                </select>
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">Auto-refresh Interval</p>
                  <p className="text-xs text-gray-400 mt-0.5">Dashboard data refresh rate</p>
                </div>
                <select
                  value={systemSettings.autoRefreshInterval}
                  onChange={(e) => setSystemSettings({ ...systemSettings, autoRefreshInterval: parseInt(e.target.value) })}
                  className="px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value={5}>5 seconds</option>
                  <option value={15}>15 seconds</option>
                  <option value={30}>30 seconds</option>
                  <option value={60}>1 minute</option>
                </select>
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">Date Format</p>
                  <p className="text-xs text-gray-400 mt-0.5">How dates are displayed</p>
                </div>
                <select
                  value={systemSettings.dateFormat}
                  onChange={(e) => setSystemSettings({ ...systemSettings, dateFormat: e.target.value })}
                  className="px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                  <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                </select>
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">Time Format</p>
                  <p className="text-xs text-gray-400 mt-0.5">12-hour or 24-hour clock</p>
                </div>
                <select
                  value={systemSettings.timeFormat}
                  onChange={(e) => setSystemSettings({ ...systemSettings, timeFormat: e.target.value })}
                  className="px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value="24h">24-hour</option>
                  <option value="12h">12-hour</option>
                </select>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-5">Regional Settings</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">Energy Unit</p>
                  <p className="text-xs text-gray-400 mt-0.5">Unit for energy consumption display</p>
                </div>
                <select
                  value={systemSettings.energyUnit}
                  onChange={(e) => setSystemSettings({ ...systemSettings, energyUnit: e.target.value })}
                  className="px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value="kWh">kWh</option>
                  <option value="MWh">MWh</option>
                </select>
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">Currency</p>
                  <p className="text-xs text-gray-400 mt-0.5">Currency for billing and payments</p>
                </div>
                <select
                  value={systemSettings.currency}
                  onChange={(e) => setSystemSettings({ ...systemSettings, currency: e.target.value })}
                  className="px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value="INR">INR (₹)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                </select>
              </div>
            </div>
            <div className="mt-6">
              <button
                onClick={handleSystemSave}
                className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors whitespace-nowrap"
              >
                Save Settings
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">About CMS</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-gray-500">Version</span>
                <span className="text-xs font-medium text-gray-700">v1.2.4</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-gray-500">Build</span>
                <span className="text-xs font-medium text-gray-700">2026.05.30-rc3</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-gray-500">OCPP Protocol</span>
                <span className="text-xs font-medium text-gray-700">1.6J (JSON)</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-gray-500">Deployment</span>
                <span className="text-xs font-medium text-gray-700">India Cloud — Mumbai Region</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-gray-500">License</span>
                <span className="text-xs font-medium text-gray-700">DFCCIL Enterprise</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}