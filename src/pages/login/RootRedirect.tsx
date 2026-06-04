import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

/** Sends "/" to dashboard when a stored session exists, otherwise to login. */
export default function RootRedirect() {
  const { isAuthenticated, isLoading } = useAuth();

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

  return <Navigate to={isAuthenticated ? "/dashboard" : "/login"} replace />;
}
