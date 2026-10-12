import type { UserRole } from "@/types/auth";
import { isSimulationEnabled } from "@/utils/simulationMode";

/** Application roles persisted in the database: SuperAdmin or User. */
export type RfpRole = "SuperAdmin" | "User";

export const WEB_ADMIN_ROLES: UserRole[] = ["SuperAdmin"];

export function normalizeRfpRole(dbRole: string): RfpRole {
  if (dbRole === "SuperAdmin") return "SuperAdmin";
  return "User";
}

export function mapDbRoleToAuthRole(role: string): UserRole {
  return normalizeRfpRole(role);
}

export function mapDisplayRole(role: string): string {
  return normalizeRfpRole(role);
}

/** Web user-management form labels → DB values. */
export function mapUiRoleToDb(role: string): string {
  if (role === "SuperAdmin" || role === "Admin") return "SuperAdmin";
  return "User";
}

export function canAccessWebAdmin(role: string): boolean {
  return normalizeRfpRole(role) === "SuperAdmin";
}

export function isWebSuperAdmin(role: string): boolean {
  return normalizeRfpRole(role) === "SuperAdmin";
}

export function isMobileEndUser(role: string): boolean {
  return normalizeRfpRole(role) === "User";
}

export function canAccessWebPath(role: string, pathname: string): boolean {
  if (!canAccessWebAdmin(role)) return false;
  return isWebSuperAdmin(role);
}

export interface WebNavItem {
  label: string;
  path: string;
  icon: string;
  roles: UserRole[];
}

export const WEB_NAV_ITEMS: WebNavItem[] = [
  { label: "Dashboard", path: "/dashboard", icon: "ri-dashboard-line", roles: ["SuperAdmin"] },
  { label: "Chargers", path: "/chargers", icon: "ri-flashlight-line", roles: ["SuperAdmin"] },
  { label: "Sessions", path: "/sessions", icon: "ri-timer-line", roles: ["SuperAdmin"] },
  { label: "Users", path: "/users", icon: "ri-group-line", roles: ["SuperAdmin"] },
  { label: "RFID Cards", path: "/rfid", icon: "ri-sim-card-line", roles: ["SuperAdmin"] },
  { label: "Tariffs", path: "/tariffs", icon: "ri-money-rupee-circle-line", roles: ["SuperAdmin"] },
  { label: "Prepaid Plans", path: "/prepaid-plans", icon: "ri-wallet-3-line", roles: ["SuperAdmin"] },
  { label: "Payments", path: "/payments", icon: "ri-bank-card-line", roles: ["SuperAdmin"] },
  { label: "Support Tickets", path: "/support-tickets", icon: "ri-customer-service-2-line", roles: ["SuperAdmin"] },
  { label: "Reports", path: "/reports", icon: "ri-bar-chart-line", roles: ["SuperAdmin"] },
  { label: "Audit Logs", path: "/audit-logs", icon: "ri-file-list-3-line", roles: ["SuperAdmin"] },
  { label: "Simulator", path: "/simulator", icon: "ri-cpu-line", roles: ["SuperAdmin"] },
  { label: "Settings", path: "/settings", icon: "ri-settings-3-line", roles: ["SuperAdmin"] },
];

export function getWebNavItemsForRole(role: string): WebNavItem[] {
  const rfp = normalizeRfpRole(role) as UserRole;
  return WEB_NAV_ITEMS.filter((item) => {
    return item.roles.includes(rfp);
  });
}

export const WEB_USER_DENIED_MESSAGE =
  "This account is for the mobile charging app only. Please use the DFCCIL EV mobile app to charge your vehicle.";

export const MOBILE_ADMIN_NOTICE =
  "Please use the Web Admin Dashboard for admin operations. This mobile view is monitoring-only.";
