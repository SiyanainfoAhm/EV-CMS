import type { UserRole } from "@/types/auth";
import { isSimulationEnabled } from "@/utils/simulationMode";

/** RFP roles: SuperAdmin, SiteAdmin, User (DB may store Operator/Viewer for User). */
export type RfpRole = "SuperAdmin" | "SiteAdmin" | "User";

export const WEB_ADMIN_ROLES: UserRole[] = ["SuperAdmin", "SiteAdmin"];

/** SuperAdmin-only web routes (SiteAdmin cannot access). */
export const SUPER_ADMIN_ONLY_PATHS = ["/tariffs", "/reports", "/audit-logs", "/simulator"] as const;

export function normalizeRfpRole(dbRole: string): RfpRole {
  if (dbRole === "SuperAdmin") return "SuperAdmin";
  if (dbRole === "SiteAdmin") return "SiteAdmin";
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
  if (role === "SiteAdmin") return "SiteAdmin";
  if (role === "User") return "Operator";
  if (role === "Viewer") return "Viewer";
  return "Operator";
}

export function canAccessWebAdmin(role: string): boolean {
  const r = normalizeRfpRole(role);
  return r === "SuperAdmin" || r === "SiteAdmin";
}

export function isWebSuperAdmin(role: string): boolean {
  return normalizeRfpRole(role) === "SuperAdmin";
}

export function isMobileEndUser(role: string): boolean {
  return normalizeRfpRole(role) === "User";
}

export function canAccessWebPath(role: string, pathname: string): boolean {
  if (!canAccessWebAdmin(role)) return false;
  if (!isSimulationEnabled() && (pathname === "/simulator" || pathname.startsWith("/simulator/"))) {
    return false;
  }
  if (isWebSuperAdmin(role)) return true;
  return !SUPER_ADMIN_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export interface WebNavItem {
  label: string;
  path: string;
  icon: string;
  roles: UserRole[];
}

export const WEB_NAV_ITEMS: WebNavItem[] = [
  { label: "Dashboard", path: "/dashboard", icon: "ri-dashboard-line", roles: ["SuperAdmin", "SiteAdmin"] },
  { label: "Chargers", path: "/chargers", icon: "ri-flashlight-line", roles: ["SuperAdmin", "SiteAdmin"] },
  { label: "Sessions", path: "/sessions", icon: "ri-timer-line", roles: ["SuperAdmin", "SiteAdmin"] },
  { label: "Users", path: "/users", icon: "ri-group-line", roles: ["SuperAdmin", "SiteAdmin"] },
  { label: "RFID Cards", path: "/rfid", icon: "ri-sim-card-line", roles: ["SuperAdmin", "SiteAdmin"] },
  { label: "Tariffs", path: "/tariffs", icon: "ri-money-rupee-circle-line", roles: ["SuperAdmin"] },
  { label: "Payments", path: "/payments", icon: "ri-bank-card-line", roles: ["SuperAdmin", "SiteAdmin"] },
  { label: "Support Tickets", path: "/support-tickets", icon: "ri-customer-service-2-line", roles: ["SuperAdmin", "SiteAdmin"] },
  { label: "Reports", path: "/reports", icon: "ri-bar-chart-line", roles: ["SuperAdmin"] },
  { label: "Audit Logs", path: "/audit-logs", icon: "ri-file-list-3-line", roles: ["SuperAdmin"] },
  { label: "Simulator", path: "/simulator", icon: "ri-cpu-line", roles: ["SuperAdmin"] },
  { label: "Settings", path: "/settings", icon: "ri-settings-3-line", roles: ["SuperAdmin", "SiteAdmin"] },
];

export function getWebNavItemsForRole(role: string): WebNavItem[] {
  const rfp = normalizeRfpRole(role) as UserRole;
  return WEB_NAV_ITEMS.filter((item) => {
    if (!isSimulationEnabled() && item.path === "/simulator") return false;
    return item.roles.includes(rfp);
  });
}

export const WEB_USER_DENIED_MESSAGE =
  "This account is for the mobile charging app only. Please use the DFCCIL EV mobile app to charge your vehicle.";

export const MOBILE_ADMIN_NOTICE =
  "Please use the Web Admin Dashboard for admin operations. This mobile view is monitoring-only.";
