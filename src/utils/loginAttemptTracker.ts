const STORAGE_PREFIX = "ev_cms_login_failures:";
const WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_FAILURE_ALERT_THRESHOLD = 3;

interface FailureState {
  count: number;
  firstAt: number;
  lastReason: string;
  alertedAt?: number;
}

function storageKey(email: string): string {
  return `${STORAGE_PREFIX}${email.trim().toLowerCase()}`;
}

function readState(email: string): FailureState | null {
  try {
    const raw = sessionStorage.getItem(storageKey(email));
    if (!raw) return null;
    return JSON.parse(raw) as FailureState;
  } catch {
    return null;
  }
}

function writeState(email: string, state: FailureState | null): void {
  try {
    if (!state) {
      sessionStorage.removeItem(storageKey(email));
      return;
    }
    sessionStorage.setItem(storageKey(email), JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function clearLoginFailures(email: string): void {
  writeState(email, null);
}

export function recordLoginFailure(
  email: string,
  reason: string
): { count: number; shouldAlertSecurity: boolean } {
  const now = Date.now();
  const existing = readState(email);

  let next: FailureState;
  if (!existing || now - existing.firstAt > WINDOW_MS) {
    next = { count: 1, firstAt: now, lastReason: reason };
  } else {
    next = {
      ...existing,
      count: existing.count + 1,
      lastReason: reason,
    };
  }

  const shouldAlertSecurity =
    next.count >= LOGIN_FAILURE_ALERT_THRESHOLD &&
    (!next.alertedAt || now - next.alertedAt > WINDOW_MS);

  if (shouldAlertSecurity) {
    next.alertedAt = now;
  }

  writeState(email, next);
  return { count: next.count, shouldAlertSecurity };
}
