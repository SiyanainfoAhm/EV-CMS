import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import * as authService from "@/services/authService";
import { completeSsoLogin } from "@/services/ssoService";

export default function SignInOidcPage() {
  const navigate = useNavigate();
  const { adoptSession } = useAuth();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void completeSsoLogin(window.location.search).then((result) => {
      if (cancelled) return;
      if (!result.success || !result.user || !result.idToken || !result.expiresAt) {
        navigate("/login", { replace: true, state: { ssoError: result.error || "SSO sign-in failed." } });
        return;
      }
      const established = authService.establishSsoSession(result.user, result.idToken, result.expiresAt);
      if (!established.success || !established.session) {
        navigate("/login", { replace: true, state: { ssoError: established.error || "SSO sign-in failed." } });
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f5f3] px-6">
      <div className="flex items-center gap-2 text-gray-500 text-sm">
        <i className="ri-loader-4-line animate-spin text-emerald-600 text-lg"></i>
        {error || "Completing DFCCIL sign-in..."}
      </div>
    </div>
  );
}
