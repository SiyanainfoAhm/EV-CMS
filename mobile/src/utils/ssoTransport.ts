import { ssoConfig } from '../config/ssoConfig';
let token: string | null = null;
let invalidated = () => {};
export function invalidateSession(): void { token = null; invalidated(); }
export function setDataSession(value: string | null): void { token = value; }
export function onSessionInvalidated(listener: () => void): () => void { invalidated = listener; return () => { invalidated = () => {}; }; }
export function backendEndpoint(resource: 'sso' | 'mobile'): string {
  const url = new URL(ssoConfig.backendUrl);
  const local = __DEV__ && url.protocol === 'http:' && ['10.0.2.2','127.0.0.1','localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('An HTTPS authentication backend is required.');
  url.pathname = url.pathname.replace(/\/sso\/?$/, `/${resource}`);
  url.search = ''; url.hash = '';
  return url.toString();
}
export async function protectedRequest(body: Record<string, unknown>): Promise<Response> {
  if (!token) throw new Error('Sign in with DFCCIL to continue.');
  const response = await fetch(backendEndpoint('mobile'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  if (response.status === 401) invalidateSession();
  return response;
}
function base64(bytes: Uint8Array): string {
  let value = '';
  for (let start = 0; start < bytes.length; start += 8192) value += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(value);
}
export const authorizedSupabaseFetch: typeof fetch = async (input, init) => {
  if (!ssoConfig.enabled) return fetch(input, init);
  const request = new Request(input, init);
  const url = new URL(request.url);
  const source = new URL(process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://invalid.local');
  if (url.origin !== source.origin) throw new Error('Unexpected database host.');
  const contentType = request.headers.get('content-type') || '';
  const hasBody = !['GET','HEAD'].includes(request.method);
  const binary = hasBody && !contentType.includes('json');
  const payload = hasBody ? (binary ? base64(new Uint8Array(await request.arrayBuffer())) : JSON.parse(await request.text() || '{}')) : undefined;
  const response = await protectedRequest({ path: url.pathname + url.search, method: request.method, payload,
    encoding: binary ? 'base64' : 'json', contentType,
    accept: request.headers.get('accept'), prefer: request.headers.get('prefer'), upsert: request.headers.get('x-upsert') });
  const result = await response.json();
  if (!response.ok) return new Response(JSON.stringify({ message: result.error, code: String(response.status) }), { status: response.status, headers: { 'Content-Type': 'application/json' } });
  return new Response(request.method === 'HEAD' || [204,205,304].includes(result.status) ? null : result.body, { status: result.status, headers: result.headers });
};
