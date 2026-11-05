import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { SignJWT, jwtVerify } from 'jose';

export const ISSUER = 'https://app2.dfccil.com';
export const SESSION_ISSUER = 'ev-cms-sso';
export const SESSION_AUDIENCE = 'ev-cms-mobile';
export function database() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function sessionKey() {
  const value = process.env.SSO_SESSION_SECRET || '';
  if (Buffer.byteLength(value) < 32) throw new Error('Session signing is not configured');
  return new TextEncoder().encode(value);
}
export function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }
export async function verifyApplicationSession(token, key = sessionKey()) {
  const { payload } = await jwtVerify(token, key, {
    issuer: SESSION_ISSUER, audience: SESSION_AUDIENCE, algorithms: ['HS256'],
    requiredClaims: ['sub', 'exp', 'iat', 'virtualId', 'jti'],
  });
  return payload;
}
export async function mappedUser(virtualId, db = database()) {
  const { data, error } = await db.from('EV_Users')
    .select('id,full_name,email,role,status,department,phone,avatar_url').eq('sso_sub', virtualId).maybeSingle();
  if (error) throw new Error('User lookup failed');
  if (!data || data.status !== 'active' || !['SuperAdmin', 'SiteAdmin', 'User'].includes(data.role)) return null;
  if (data.avatar_url) {
    try {
      const url = new URL(data.avatar_url);
      const match = /\/storage\/v1\/object\/(?:sign|public)\/ev-media\/(.+)$/.exec(url.pathname);
      if (match && match[1].startsWith(`EV/${data.id}/`) && !/[%.]/.test(match[1].split('/').slice(0,-1).join('/'))) {
        const { data: signed } = await db.storage.from('ev-media').createSignedUrl(match[1], 300);
        data.avatar_url = signed?.signedUrl || null;
      }
    } catch { data.avatar_url = null; }
  }
  return { id: data.id, name: data.full_name, email: data.email, role: data.role,
    department: data.department, phone: data.phone, avatarUrl: data.avatar_url };
}
export async function issueSession(user, virtualId, expiry, db = database()) {
  const id = randomUUID();
  const token = await new SignJWT({ virtualId }).setProtectedHeader({ alg: 'HS256' })
    .setIssuer(SESSION_ISSUER).setAudience(SESSION_AUDIENCE).setSubject(user.id)
    .setJti(id).setIssuedAt().setExpirationTime(expiry).sign(sessionKey());
  const expiresAt = new Date(expiry * 1000).toISOString();
  const { error } = await db.from('EV_UserSessions').insert({ id, user_id: user.id,
    token_hash: tokenHash(token), expires_at: expiresAt, user_agent: 'EV-CMS mobile SSO' });
  if (error) throw new Error('Session persistence failed');
  return { token, user, expiresAt };
}
export async function authenticate(token, db = database(), key = sessionKey()) {
  const claims = await verifyApplicationSession(token, key);
  const { data: row, error } = await db.from('EV_UserSessions')
    .select('id,user_id,token_hash,expires_at,revoked_at').eq('id', claims.jti).maybeSingle();
  if (error || !row || row.revoked_at || row.user_id !== claims.sub ||
      !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) throw new Error('Session expired or revoked');
  const expected = Buffer.from(row.token_hash || '');
  const actual = Buffer.from(tokenHash(token));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('Invalid session');
  const user = await mappedUser(claims.virtualId, db);
  if (!user || user.id !== claims.sub) throw new Error('User access is inactive');
  return { claims, user, token, expiresAt: new Date(claims.exp * 1000).toISOString() };
}
export function bearer(req) {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) throw new Error('Sign in again');
  return header.slice(7);
}
export async function revokeSession(auth, all = false, db = database()) {
  let q = db.from('EV_UserSessions').update({ revoked_at: new Date().toISOString() }).eq('user_id', auth.user.id);
  if (!all) q = q.eq('id', auth.claims.jti);
  const { error } = await q;
  if (error) throw new Error('Could not revoke session');
}
