// X-User-Id is trusted only after authenticating the EV-CMS backend.
export async function isTrustedBackend(request: Request): Promise<boolean> {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) return false;
  const supplied = request.headers.get('authorization') || '';
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
    crypto.subtle.digest('SHA-256', encoder.encode(`Bearer ${secret}`)),
  ]);
  const left = new Uint8Array(a); const right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
