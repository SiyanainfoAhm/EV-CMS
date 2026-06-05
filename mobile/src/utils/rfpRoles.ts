import type { UserRole } from "../types";

export type RfpRole = "SuperAdmin" | "SiteAdmin" | "User";

export function normalizeRfpRole(dbRole: string): RfpRole {
  if (dbRole === "SuperAdmin") return "SuperAdmin";
  if (dbRole === "SiteAdmin") return "SiteAdmin";
  return "User";
}

export function mapDbRoleToAuthRole(role: string): UserRole {
  return normalizeRfpRole(role);
}

export function isMobileEndUser(role: string): boolean {
  return normalizeRfpRole(role) === "User";
}

export function isMobileAdmin(role: string): boolean {
  const r = normalizeRfpRole(role);
  return r === "SuperAdmin" || r === "SiteAdmin";
}

export function getDisplayRoleLabel(role: string): string {
  return normalizeRfpRole(role);
}

/** Quick actions shown on mobile home — User vs admin monitoring. */
export const MOBILE_USER_MENU = [
  "Chargers",
  "LiveSession",
  "SessionHistory",
  "PaymentHistory",
  "RFIDBinding",
  "Profile",
  "Support",
] as const;

export const MOBILE_ADMIN_MENU = ["Chargers", "SessionHistory", "Profile", "Support"] as const;

export function getMobileMenuRoutes(role: string): readonly string[] {
  return isMobileEndUser(role) ? MOBILE_USER_MENU : MOBILE_ADMIN_MENU;
}

export const MOBILE_ADMIN_NOTICE =
  "Please use the Web Admin Dashboard for admin operations. This mobile view is monitoring-only.";
