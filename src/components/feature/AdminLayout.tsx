import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import SimulationModeBadge from "@/components/common/SimulationModeBadge";
import NotificationBell from "@/components/feature/NotificationBell";
import GlobalSearch from "@/components/feature/GlobalSearch";
import { startSimulatorRuntime } from "@/services/simulatorRuntime";
import { isSimulationEnabled } from "@/utils/simulationMode";
import { getWebNavItemsForRole, normalizeRfpRole } from "@/utils/rfpRoles";
import { useInactivityLogout } from "@/hooks/useInactivityLogout";
import { useAdminOperationalAlertEmail } from "@/hooks/useAdminOperationalAlertEmail";

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  const currentPath = location.pathname;
  const displayName = user?.name ?? "User";
  const displayEmail = user?.email ?? "";
  const displayRole =
    user?.role === "SuperAdmin"
      ? "Super Admin"
      : user?.role === "SiteAdmin"
        ? "Site Admin"
        : normalizeRfpRole(user?.role ?? "User");
  const navItems = user ? getWebNavItemsForRole(user.role) : [];
  const avatarUrl = user?.avatarUrl;
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const requestLogout = () => {
    setUserMenuOpen(false);
    setLogoutConfirmOpen(true);
  };

  const confirmLogout = async () => {
    setLogoutConfirmOpen(false);
    await logout();
    navigate("/login");
  };

  useEffect(() => {
    if (!isSimulationEnabled()) return;
    if (user?.role === "SuperAdmin" || user?.role === "SiteAdmin") {
      startSimulatorRuntime();
    }
  }, [user?.role]);

  useInactivityLogout(() => navigate("/login", { state: { sessionExpired: true } }));
  useAdminOperationalAlertEmail();

  return (
    <div className="min-h-screen bg-[#f5f5f3] flex">
      <aside
        className={`fixed inset-y-0 left-0 z-30 bg-[#1a1a2e] text-white flex flex-col transition-all duration-300 ${
          sidebarCollapsed ? "w-20" : "w-64"
        }`}
      >
        <div className="flex items-center gap-3 px-5 h-16 border-b border-white/10">
          <div className="w-9 h-9 flex items-center justify-center bg-emerald-500 rounded-lg flex-shrink-0">
            <i className="ri-flashlight-fill text-white text-lg"></i>
          </div>
          {!sidebarCollapsed && (
            <div>
              <p className="text-sm font-semibold whitespace-nowrap" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                DFCCIL EV CMS
              </p>
              <p className="text-xs text-gray-400">Admin Panel</p>
            </div>
          )}
        </div>

        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = currentPath === item.path || (item.path !== "/dashboard" && currentPath.startsWith(item.path));
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors whitespace-nowrap ${
                  isActive
                    ? "bg-emerald-600 text-white font-medium"
                    : "text-gray-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                  <i className={`${item.icon} ${sidebarCollapsed ? "text-lg" : ""}`}></i>
                </div>
                {!sidebarCollapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-3">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="w-full flex items-center justify-center p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <i className={sidebarCollapsed ? "ri-arrow-right-s-line text-lg" : "ri-arrow-left-s-line text-lg"}></i>
          </button>
        </div>
      </aside>

      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${sidebarCollapsed ? "ml-20" : "ml-64"}`}>
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 sticky top-0 z-20">
          <div className="flex items-center gap-4">
            <GlobalSearch />
          </div>

          <div className="flex items-center gap-4">
            <NotificationBell />

            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2.5 hover:bg-gray-100 rounded-lg px-2 py-1.5 transition-colors cursor-pointer"
              >
                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center overflow-hidden">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-sm font-semibold text-emerald-700">{initials}</span>
                  )}
                </div>
                <div className="text-left hidden sm:block">
                  <p className="text-sm font-medium text-gray-900">{displayName}</p>
                  <p className="text-xs text-gray-500">{displayRole}</p>
                </div>
                <i className="ri-arrow-down-s-line text-gray-400 text-sm hidden sm:block"></i>
              </button>

              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)}></div>
                  <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <p className="text-sm font-medium text-gray-900">{displayName}</p>
                      <p className="text-xs text-gray-500">{displayEmail}</p>
                    </div>
                    <button onClick={() => { setUserMenuOpen(false); navigate("/settings"); }} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 whitespace-nowrap">
                      <i className="ri-user-settings-line"></i> Profile
                    </button>
                    <button onClick={() => { setUserMenuOpen(false); navigate("/settings"); }} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 whitespace-nowrap">
                      <i className="ri-settings-3-line"></i> Settings
                    </button>
                    <div className="border-t border-gray-100 mt-1 pt-1">
                      <button
                        onClick={requestLogout}
                        className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 whitespace-nowrap"
                      >
                        <i className="ri-logout-box-line"></i> Sign out
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

      {logoutConfirmOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setLogoutConfirmOpen(false)}></div>
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 flex items-center justify-center rounded-full bg-red-100">
                  <i className="ri-logout-box-line text-red-600 text-lg"></i>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">Sign out</h4>
                  <p className="text-xs text-gray-500">End your admin session</p>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Are you sure you want to sign out? You will need to enter your credentials again to access the dashboard.
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setLogoutConfirmOpen(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmLogout}
                  className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors whitespace-nowrap"
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </>
      )}

        <main className="flex-1 p-6 min-w-0 overflow-x-hidden">
          {isSimulationEnabled() && (
            <div className="mb-4">
              <SimulationModeBadge compact />
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}