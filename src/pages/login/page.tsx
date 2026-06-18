import { useState, useEffect, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { canAccessWebAdmin, WEB_USER_DENIED_MESSAGE } from "@/utils/rfpRoles";
import { FormField, inputClassName } from "@/components/ui/FormField";
import { validateEmail, validateLoginPassword } from "@/utils/validation";

/** Login left panel — place your artwork at public/images/login-hero.png */
const LOGIN_BG = "/images/login-hero.png?v=2";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated, isLoading, user, logout } = useAuth();
  const [email, setEmail] = useState("anita.desai@dfccil.gov.in");
  const [password, setPassword] = useState("dfccil123");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isLoading || !isAuthenticated || !user) return;
    if (canAccessWebAdmin(user.role)) {
      navigate("/dashboard", { replace: true });
    } else {
      logout();
    }
  }, [isAuthenticated, isLoading, user, navigate, logout]);

  useEffect(() => {
    if ((location.state as { webAccessDenied?: boolean })?.webAccessDenied) {
      setError(WEB_USER_DENIED_MESSAGE);
    }
  }, [location.state]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f3]">
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <i className="ri-loader-4-line animate-spin text-emerald-600 text-lg"></i>
          Restoring session...
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    const emailErr = validateEmail(email, { dfccilOnly: true });
    const passwordErr = validateLoginPassword(password);
    const errors = {
      ...(emailErr ? { email: emailErr } : {}),
      ...(passwordErr ? { password: passwordErr } : {}),
    };
    setFieldErrors(errors);
    if (emailErr || passwordErr) return;

    setLoading(true);
    const result = await login({ email: email.trim(), password });
    setLoading(false);
    if (result.success) {
      navigate("/dashboard");
    } else {
      setError(result.error || "Invalid credentials. Use your DFCCIL email.");
    }
  };

  return (
    <div className="min-h-screen flex bg-[#f7f7f5]">
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-[#1a1a2e]">
        <div
          className="absolute inset-0 bg-cover bg-no-repeat opacity-45"
          style={{
            backgroundImage: `url(${LOGIN_BG})`,
            backgroundPosition: "left center",
          }}
          role="img"
          aria-label="EV charging station with circuit board background"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/50 via-[#1a1a2e]/60 to-[#0a0a14]/80"></div>
        <div className="relative z-10 flex flex-col justify-center px-20 text-white">
          <div className="mb-8">
            <div className="w-14 h-14 flex items-center justify-center bg-emerald-500 rounded-xl mb-6">
              <i className="ri-flashlight-fill text-2xl text-white"></i>
            </div>
            <h1 className="text-4xl font-bold leading-tight mb-4" style={{ fontFamily: "'DM Sans', sans-serif" }}>
              DFCCIL EV Charger
              <br />
              Management System
            </h1>
            <p className="text-lg text-gray-300 max-w-md">
              Private CMS for authorized DFCCIL personnel. Monitor, control, and manage your EV charging infrastructure.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-10 text-center">
            <div className="w-12 h-12 flex items-center justify-center bg-emerald-500 rounded-xl mx-auto mb-4">
              <i className="ri-flashlight-fill text-xl text-white"></i>
            </div>
            <h2 className="text-2xl font-bold" style={{ fontFamily: "'DM Sans', sans-serif" }}>
              DFCCIL EV CMS
            </h2>
          </div>

          <div className="mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-2" style={{ fontFamily: "'DM Sans', sans-serif" }}>
              Welcome back
            </h2>
            <p className="text-gray-500">Sign in to access the charger management dashboard</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                <i className="ri-error-warning-line"></i>
                {error}
              </div>
            )}

            <FormField label="Email address" error={fieldErrors.email} required htmlFor="email">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <i className="ri-mail-line text-gray-400"></i>
                </div>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
                  }}
                  placeholder="name@dfccil.gov.in"
                  className={`${inputClassName(!!fieldErrors.email)} pl-10`}
                />
              </div>
            </FormField>

            <FormField label="Password" error={fieldErrors.password} required htmlFor="password">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <i className="ri-lock-line text-gray-400"></i>
                </div>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
                  }}
                  placeholder="Enter your password"
                  className={`${inputClassName(!!fieldErrors.password)} pl-10`}
                />
              </div>
            </FormField>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap"
            >
              {loading ? (
                <>
                  <i className="ri-loader-4-line animate-spin"></i> 
                  Signing in...
                </>
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-gray-400">
            DFCCIL Authorized Personnel Only. Unauthorized access is prohibited and will be prosecuted.
          </p>
        </div>
      </div>
    </div>
  );
}
