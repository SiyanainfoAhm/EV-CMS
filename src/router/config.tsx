import type { RouteObject } from "react-router-dom";
import NotFound from "../pages/NotFound";
import LoginPage from "../pages/login/page";
import RootRedirect from "../pages/login/RootRedirect";
import AdminLayout from "../components/feature/AdminLayout";
import ProtectedRoute from "@/app/ProtectedRoute";
import DashboardPage from "../pages/dashboard/page";
import ChargersPage from "../pages/chargers/page";
import ChargerDetailPage from "../pages/chargers/detail/page";
import SessionsPage from "../pages/sessions/page";
import UsersPage from "../pages/users/page";
import RfidPage from "../pages/rfid/page";
import TariffsPage from "../pages/tariffs/page";
import PaymentsPage from "../pages/payments/page";
import ReportsPage from "../pages/reports/page";
import AuditLogsPage from "../pages/audit-logs/page";
import SettingsPage from "../pages/settings/page";
import SimulatorPage from "../pages/simulator/page";
import NotificationsPage from "../pages/notifications/page";

const routes: RouteObject[] = [
  {
    path: "/",
    element: <RootRedirect />,
  },
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <AdminLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        path: "/dashboard",
        element: <DashboardPage />,
      },
      {
        path: "/chargers",
        element: <ChargersPage />,
      },
      {
        path: "/chargers/:id",
        element: <ChargerDetailPage />,
      },
      {
        path: "/sessions",
        element: <SessionsPage />,
      },
      {
        path: "/users",
        element: <UsersPage />,
      },
      {
        path: "/rfid",
        element: <RfidPage />,
      },
      {
        path: "/tariffs",
        element: <TariffsPage />,
      },
      {
        path: "/payments",
        element: <PaymentsPage />,
      },
      {
        path: "/reports",
        element: <ReportsPage />,
      },
      {
        path: "/audit-logs",
        element: <AuditLogsPage />,
      },
      {
        path: "/settings",
        element: <SettingsPage />,
      },
      {
        path: "/simulator",
        element: <SimulatorPage />,
      },
      {
        path: "/notifications",
        element: <NotificationsPage />,
      },
    ],
  },
  {
    path: "*",
    element: <NotFound />,
  },
];

export default routes;