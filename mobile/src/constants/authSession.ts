export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createSessionExpiresAt(fromMs = Date.now()): string {
  return new Date(fromMs + SESSION_TTL_MS).toISOString();
}

export function isSessionExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return false;
  return t < Date.now();
}
