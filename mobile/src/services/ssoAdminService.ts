import { getSessionMeta } from './authService';
import { backendEndpoint, invalidateSession } from '../utils/ssoTransport';
export interface ManagedUser { id: string; full_name: string; email: string; role: string; status: string; sso_sub: string | null }
export async function adminCommand<T>(action: string, values: Record<string, unknown> = {}): Promise<T> {
  const session = getSessionMeta();
  if (!session) throw new Error('Sign in again.');
  const response = await fetch(backendEndpoint('sso'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ action, ...values }), signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (response.status === 401) invalidateSession();
  if (!response.ok) throw new Error(result.error || 'Administrator request failed.');
  return result as T;
}
