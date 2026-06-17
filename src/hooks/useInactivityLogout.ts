import { useEffect, useRef } from "react";
import * as authService from "@/services/authService";

const IDLE_TIMEOUT_KEY = "ev_cms_idle_timeout_min";
const DEFAULT_IDLE_MINUTES = 30;

function idleMinutes(): number {
  try {
    const v = parseInt(localStorage.getItem(IDLE_TIMEOUT_KEY) || String(DEFAULT_IDLE_MINUTES), 10);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_IDLE_MINUTES;
  } catch {
    return DEFAULT_IDLE_MINUTES;
  }
}

export function setIdleTimeoutMinutes(minutes: number): void {
  try {
    localStorage.setItem(IDLE_TIMEOUT_KEY, String(minutes));
  } catch {
    /* ignore */
  }
}

/** Auto-logout after configured inactivity (Settings → Session Timeout). */
export function useInactivityLogout(onLogout: () => void): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLogoutRef = useRef(onLogout);
  onLogoutRef.current = onLogout;

  useEffect(() => {
    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const ms = idleMinutes() * 60 * 1000;
      timerRef.current = setTimeout(() => {
        void authService.logout().then(() => onLogoutRef.current());
      }, ms);
    };

    const events = ["mousedown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, []);
}
