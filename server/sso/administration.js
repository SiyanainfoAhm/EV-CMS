import { randomBytes, randomUUID } from 'node:crypto';
import { database } from './sessions.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function administer(body, auth, db = database()) {
  if (auth.user.role !== 'SuperAdmin') throw new Error('Administrator access required');
  if (body.action === 'admin-users') {
    const { data, error } = await db.from('EV_Users').select('id,full_name,email,role,status,sso_sub').order('full_name').limit(500);
    if (error) throw new Error('User lookup failed');
    return { users: data };
  }
  if (body.action === 'admin-revoke') {
    if (!uuid.test(body.userId || '')) throw new Error('Invalid user ID');
    const { error } = await db.from('EV_UserSessions').update({ revoked_at: new Date().toISOString() }).eq('user_id', body.userId);
    if (error) throw new Error('Revocation failed');
    return { success: true };
  }
  if (body.action !== 'admin-provision' || !uuid.test(body.virtualId || '') ||
      !['SuperAdmin', 'User'].includes(body.role) || !['active', 'inactive', 'suspended'].includes(body.status)) {
    throw new Error('Invalid provisioning request');
  }
  if (body.userId === auth.user.id && (body.role !== 'SuperAdmin' || body.status !== 'active')) throw new Error('Use another administrator to change your access');
  const values = { sso_sub: body.virtualId, role: body.role, status: body.status, updated_at: new Date().toISOString() };
  let id = body.userId;
  if (id) {
    if (!uuid.test(id)) throw new Error('Invalid user ID');
    const { data, error } = await db.from('EV_Users').update(values).eq('id', id).select('id').single();
    if (error || !data) throw new Error('Mapping could not be updated; check user and subject uniqueness');
  } else {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200 ||
        typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || body.email.length > 254) throw new Error('Name and email required for new users');
    id = randomUUID();
    const { error } = await db.from('EV_Users').insert({ ...values, id, full_name: body.name.trim(), email: body.email.trim(),
      // No known password is created. Provisioned accounts authenticate through SSO.
      password_hash: randomBytes(48).toString('hex'), salt: randomBytes(32).toString('hex') });
    if (error) throw new Error('Account could not be provisioned; check email and subject uniqueness');
  }
  // Force existing sessions to reauthenticate after mapping/permission changes.
  const { error } = await db.from('EV_UserSessions').update({ revoked_at: new Date().toISOString() }).eq('user_id', id);
  if (error) throw new Error('Account saved but session revocation failed; retry revocation');
  await db.from('EV_AuditLogs').insert({ user_id: auth.user.id, action: 'sso_user_provisioned', entity_type: 'user', entity_id: id, details: 'SSO mapping/permissions managed by administrator' });
  return { success: true, userId: id };
}
