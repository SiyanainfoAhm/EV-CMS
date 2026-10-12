import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import * as authService from "@/services/authService";
import { completeSsoLogin } from "@/services/ssoService";

export default function SignInOidcPage() {
  const navigate = useNavigate();
  const { adoptSession } = useAuth();
  const [error, setError] = useState("");
  const [response, setResponse] = useState<{ success: boolean; message: string; accessDenied?: boolean; idToken?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void completeSsoLogin(window.location.search).then((result) => {
      if (cancelled) return;
      if (!result.success || !result.user || !result.idToken || !result.expiresAt) {
        setResponse({ success: false, message: result.error || "SSO sign-in failed." });
        return;
      }
      const established = authService.establishSsoSession(result.user, result.idToken, result.expiresAt);
      if (!established.success || !established.session) {
        setResponse({
          success: false,
          accessDenied: result.user.role === "User",
          idToken: result.idToken,
          message: result.user.role === "User"
            ? "You are authenticated, but you do not have access to the web application. Please contact an administrator if you need web access."
            : established.error || "SSO sign-in failed.",
        });
        return;
      }
      adoptSession(established.session);
      navigate("/dashboard", { replace: true });
    }).catch((e: unknown) => {
      if (cancelled) return;
      setError(e instanceof Error ? e.message : "SSO sign-in failed.");
    });
    return () => {
      cancelled = true;
    };
  }, [adoptSession, navigate]);

  const handleDone = async () => {
    if (response?.accessDenied) {
      const redirectedToSsoLogout = await authService.logout();
      if (redirectedToSsoLogout) return;
      window.location.replace("/login");
      return;
    }
    navigate(response?.success ? "/dashboard" : "/login", { replace: true });
  };

  if (response) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f3] px-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm border border-gray-100">
          <div className={`mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full ${response.success ? "bg-emerald-100" : "bg-red-100"}`}>
            <i className={`${response.success ? "ri-check-line text-emerald-600" : "ri-close-line text-red-600"} text-3xl`} />
          </div>
          <h1 className="mb-2 text-2xl font-bold text-gray-900">
            {response.accessDenied ? "Web access unavailable" : "Login failed"}
          </h1>
          <p className="mb-6 text-sm text-gray-500">{response.message}</p>
          <button
            type="button"
            onClick={handleDone}
            className="w-full rounded-lg bg-emerald-600 py-3 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            {response.accessDenied ? "Login again" : "Back to login"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f5f3] px-6">
      <div className="flex items-center gap-2 text-gray-500 text-sm">
        <i className="ri-loader-4-line animate-spin text-emerald-600 text-lg"></i>
        {error || "Completing DFCCIL sign-in..."}
      </div>
    </div>
  );
}
