/** Demo password hashing — must match PostgreSQL: encode(digest(password || salt, 'sha256'), 'hex') */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(password + salt);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const DEMO_PASSWORD = "dfccil123";
export const DEMO_SALT = "ev_salt_2026";
