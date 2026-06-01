import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import type { UserRole } from "@/types/auth";

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: UserRole[];
}

export default function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, hasRole } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f3]">
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <i className="ri-loader-4-line animate-spin text-emerald-600 text-lg"></i>
          Loading...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && allowedRoles.length > 0 && !hasRole(allowedRoles)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
