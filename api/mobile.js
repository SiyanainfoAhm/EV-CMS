import { authenticate, bearer, database } from '../server/sso/sessions.js';
import { AccessDenied, secureQuery, secureWrite } from '../server/sso/data-policy.js';

const rpcArguments = {
  get_ev_user_profile: ['p_user_id'],
  update_ev_user_profile: ['p_user_id','p_full_name','p_email','p_phone','p_department','p_avatar_url'],
  ev_mobile_assert_charger_online: ['p_charger_id'],
  ev_get_payment_gateway_public: [],
  ev_get_session_payment: ['p_user_id','p_session_id'],
  ev_sync_session_payment_bill: ['p_user_id','p_session_id'],
};
export async function assertOwned(db, table, id, userId) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new AccessDenied('Invalid record');
  const { data, error } = await db.from(table).select('id').eq('id', id).eq('user_id', userId).maybeSingle();
  if (error || !data) throw new AccessDenied('Record is not owned by the signed-in user');
}
export function rpcBody(name, value, user) {
  const allowed = rpcArguments[name];
  if (!allowed || !value || Array.isArray(value) || typeof value !== 'object') throw new AccessDenied('RPC is not exposed');
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new AccessDenied('Unexpected RPC argument');
  if (value.p_user_id !== undefined && value.p_user_id !== user.id) throw new AccessDenied('Cannot access another user');
  return { ...value, ...(allowed.includes('p_user_id') ? { p_user_id: user.id } : {}) };
}
function ownStoragePath(path, userId) {
  return typeof path === 'string' && !/[\\%]/.test(path) && !path.split('/').some(p => p === '.' || p === '..' || p === '') &&
    (path.startsWith(`EV/${userId}/`) || path.startsWith(`support-tickets/${userId}/`));
}
export function storagePolicy(path, method, body, user) {
  const prefix = '/storage/v1/';
  if (!path.startsWith(prefix) || path.includes('?') || path.includes('#')) throw new AccessDenied('Invalid storage path');
  const relative = decodeURIComponent(path.slice(prefix.length));
  if (relative === 'object/list/ev-media' && method === 'POST') {
    if (!ownStoragePath(`${body.prefix}/file`, user.id)) throw new AccessDenied('Storage prefix is not owned');
    return { ...body, limit: Math.min(Number(body.limit) || 100, 100) };
  }
  if (relative === 'object/ev-media' && method === 'DELETE') {
    if (!Array.isArray(body.prefixes) || body.prefixes.length > 100 || !body.prefixes.every(p => ownStoragePath(p, user.id))) throw new AccessDenied('Storage object is not owned');
    return { prefixes: body.prefixes };
  }
  const match = /^object\/(sign\/)?ev-media\/(.+)$/.exec(relative);
  if (!match || !ownStoragePath(match[2], user.id)) throw new AccessDenied('Storage object is not owned');
  if (match[1] && method === 'POST') return { expiresIn: 300 };
  if (!match[1] && ['POST','PUT'].includes(method)) return body;
  throw new AccessDenied('Storage operation is not exposed');
}
async function gatewayOperation(body, auth, db) {
  const gateway = process.env.OCPP_GATEWAY_API_URL;
  if (!gateway?.startsWith('https://') || !process.env.OCPP_GATEWAY_API_KEY) {
    const error = new Error('Authenticated charging gateway is not configured'); error.status = 503; throw error;
  }
  const p = body.payload;
  if (!p || typeof p.chargePointId !== 'string' || p.bypassRfid) throw new AccessDenied('Invalid charging request');
  if (auth.user.role !== 'User') throw new AccessDenied('Mobile administrators have monitoring access only');
  const payload = { chargePointId: p.chargePointId, bypassRfid: false, userId: auth.user.id };
  const { data: charger, error } = await db.from('EV_Chargers').select('id').eq('charge_point_id', p.chargePointId).maybeSingle();
  if (error || !charger) throw new AccessDenied('Charger not found');
  if (body.operation === 'start') {
    if (!Number.isInteger(p.connectorId) || p.connectorId < 1) throw new AccessDenied('Invalid connector');
    // Financial claims and arbitrary RFID/admin tags from the client are never forwarded.
    Object.assign(payload, { connectorId: p.connectorId, idTag: `MOBILE-${auth.user.id}` });
  } else if (body.operation === 'stop') {
    if (!Number.isInteger(p.transactionId)) throw new AccessDenied('Invalid transaction');
    const { data: session } = await db.from('EV_ChargingSessions').select('id').eq('transaction_id', p.transactionId)
      .eq('charger_id', charger.id).eq('user_id', auth.user.id).eq('status', 'active').maybeSingle();
    if (!session) throw new AccessDenied('Cannot stop another user’s session');
    payload.transactionId = p.transactionId;
  } else throw new AccessDenied('Unknown gateway operation');
  return fetch(`${gateway.replace(/\/$/, '')}/ocpp/remote-${body.operation}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OCPP_GATEWAY_API_KEY}` },
    body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(15000),
  });
}
export async function dataRequest(body, auth, db = database()) {
  if (body.action === 'rfid-bind') {
    if (auth.user.role !== 'User' || typeof body.uid !== 'string') throw new AccessDenied('RFID binding requires an end-user account');
    const uid = body.uid.trim().toUpperCase();
    if (!/^[A-Z0-9:-]{4,64}$/.test(uid) || /^(MOBILE-|ADMIN)/.test(uid)) throw new AccessDenied('Invalid physical RFID UID');
    const { data: target, error: lookupError } = await db.from('EV_RFIDCards').select('id,user_id,status').eq('uid', uid).maybeSingle();
    if (lookupError) throw new Error('RFID lookup failed');
    if (target && (target.status === 'blocked' || (target.user_id && target.user_id !== auth.user.id))) throw new AccessDenied('RFID card is unavailable');
    const { data: existing, error: existingError } = await db.from('EV_RFIDCards').select('id,status').eq('user_id',auth.user.id).maybeSingle();
    if (existingError || existing?.status === 'blocked') throw new AccessDenied('Contact an administrator about the existing RFID card');
    let result;
    if (target) {
      if (existing && existing.id !== target.id) {
        const {error} = await db.from('EV_RFIDCards').update({user_id:null,status:'inactive'}).eq('id',existing.id).eq('user_id',auth.user.id).neq('status','blocked');
        if (error) throw new Error('Could not release existing card');
      }
      // Conditional UPDATE re-checks ownership under PostgreSQL's row lock.
      result = await db.from('EV_RFIDCards').update({user_id:auth.user.id,status:'active'})
        .eq('id',target.id).neq('status','blocked').or(`user_id.is.null,user_id.eq.${auth.user.id}`).select('id,uid,user_id,status').single();
    } else if (existing) {
      result = await db.from('EV_RFIDCards').update({uid,status:'active'}).eq('id',existing.id).eq('user_id',auth.user.id).neq('status','blocked').select('id,uid,user_id,status').single();
    } else result = await db.from('EV_RFIDCards').insert({uid,user_id:auth.user.id,status:'active',total_sessions:0}).select('id,uid,user_id,status').single();
    if (result.error || !result.data) throw new AccessDenied('RFID binding conflicted with another update. Please retry.');
    return new Response(JSON.stringify(result.data), {status:200});
  }
  if (body.action === 'limits') {
    if (auth.user.role !== 'User') throw new AccessDenied('Mobile administrators have monitoring access only');
    await assertOwned(db, 'EV_ChargingSessions', body.sessionId, auth.user.id);
    if (!['amount','time'].includes(body.mode) || !Number.isFinite(body.value) || body.value <= 0 || body.value > 100000) throw new AccessDenied('Invalid charging limit');
    const { data: session } = await db.from('EV_ChargingSessions').select('id,status,charger_id').eq('id', body.sessionId).single();
    if (!session || session.status !== 'active') throw new AccessDenied('Charging limits require an active session');
    const update = { prepaid_mode: body.mode, prepaid_value: body.value, updated_at: new Date().toISOString() };
    if (body.mode === 'time') {
      if (body.value > 1440) throw new AccessDenied('Time limit cannot exceed one day');
      update.prepaid_duration_minutes = body.value;
      update.prepaid_expires_at = new Date(Date.now() + body.value * 60000).toISOString();
    } else {
      const { data: charger } = await db.from('EV_Chargers').select('tariff_id').eq('id', session.charger_id).single();
      let q = db.from('EV_Tariffs').select('rate_per_kwh,session_fee,gst_percent').eq('is_active', true);
      q = charger?.tariff_id ? q.eq('id', charger.tariff_id) : q.eq('is_default', true);
      const { data: tariff, error } = await q.limit(1).maybeSingle();
      if (error || !tariff || !(Number(tariff.rate_per_kwh) > 0)) throw new AccessDenied('A server-configured tariff is required');
      const energyAmount = body.value / (1 + Number(tariff.gst_percent || 0) / 100) - Number(tariff.session_fee || 0);
      if (!(energyAmount > 0)) throw new AccessDenied('Limit must exceed the session fee');
      update.prepaid_amount = body.value;
      update.prepaid_energy_cap_kwh = energyAmount / Number(tariff.rate_per_kwh);
      update.target_kwh = update.prepaid_energy_cap_kwh;
    }
    const { error } = await db.from('EV_ChargingSessions').update(update).eq('id', body.sessionId).eq('user_id', auth.user.id).eq('status','active');
    if (error) throw new Error('Could not save charging limits');
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  if (body.action === 'gateway') return gatewayOperation(body, auth, db);
  const method = body.method;
  if (!['GET','HEAD','POST','PATCH','PUT','DELETE'].includes(method) || typeof body.path !== 'string') throw new AccessDenied('Invalid request');
  let path = body.path; let payload = body.payload;
  const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(path);
  if (rpc) {
    if (method !== 'POST') throw new AccessDenied('RPC requires POST');
    payload = rpcBody(rpc[1], payload, auth.user);
    if (payload.p_session_id) await assertOwned(db, 'EV_ChargingSessions', payload.p_session_id, auth.user.id);
  } else if (path.startsWith('/rest/v1/')) {
    const query = secureQuery(path, method, auth.user);
    const conflict = query.url.searchParams.get('on_conflict');
    if ((conflict || String(body.prefer || '').includes('resolution=')) &&
        !(query.table === 'EV_UserPushTokens' && conflict === 'user_id,token')) throw new AccessDenied('Upsert is not exposed for this table');
    if (!['GET','HEAD'].includes(method)) {
      payload = secureWrite(query.table, method, payload, auth.user);
      if (query.table === 'EV_RFIDCards' && method === 'PATCH') query.url.searchParams.set('status', 'neq.blocked');
    }
    path = query.url.pathname + query.url.search;
  } else if (path.startsWith('/storage/v1/')) {
    payload = storagePolicy(path, method, payload, auth.user);
  } else if (path.startsWith('/functions/v1/')) {
    const functions = new Set(['ev-cms-mobile-session-create-razorpay-order','ev-cms-mobile-session-verify-razorpay-payment']);
    if (method !== 'POST' || !functions.has(path.slice('/functions/v1/'.length))) throw new AccessDenied('Function not exposed');
    if (!payload || typeof payload !== 'object') throw new AccessDenied('Invalid payment request');
    const creating = path.endsWith('create-razorpay-order');
    if (creating && process.env.DFCCIL_PAYMENT_APP_ID) throw new AccessDenied('Use DFCCIL online payment from the final bill.');
    const allowed = creating ? ['session_id','currency'] : ['payment_order_id','razorpay_order_id','razorpay_payment_id','razorpay_signature'];
    if (Object.keys(payload).some(key => !allowed.includes(key))) throw new AccessDenied('Unexpected payment argument');
    if (creating) {
      await assertOwned(db, 'EV_ChargingSessions', payload.session_id, auth.user.id);
      payload = { session_id: payload.session_id, currency: 'INR' };
    } else {
      await assertOwned(db, 'EV_Payments', payload.payment_order_id, auth.user.id);
      if (allowed.some(key => typeof payload[key] !== 'string' || !payload[key] || payload[key].length > 256)) throw new AccessDenied('Invalid payment verification');
    }
  } else throw new AccessDenied('Endpoint is not exposed');
  const headers = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'X-User-Id': auth.user.id };
  // Only representation/count/conflict preferences are allowed, never arbitrary headers/schemas.
  if (body.accept === 'application/vnd.pgrst.object+json') headers.Accept = body.accept;
  if (typeof body.prefer === 'string') {
    const preferences = body.prefer.split(',').map(s => s.trim());
    if (preferences.some(s => !/^(return=(representation|minimal)|count=(exact|planned|estimated)|resolution=(merge|ignore)-duplicates)$/.test(s))) throw new AccessDenied('Invalid request preference');
    headers.Prefer = preferences.join(',');
  }
  let requestBody;
  if (!['GET','HEAD'].includes(method)) {
    if (body.encoding === 'base64') {
      if (!path.startsWith('/storage/v1/object/ev-media/') || typeof payload !== 'string' || payload.length > 2_800_000) throw new AccessDenied('Invalid upload');
      headers['Content-Type'] = ['image/jpeg','image/png','image/webp','image/gif','application/pdf'].includes(body.contentType) ? body.contentType : 'application/octet-stream';
      if (body.upsert === 'true') headers['x-upsert'] = 'true';
      requestBody = Buffer.from(payload, 'base64');
    } else { headers['Content-Type'] = 'application/json'; requestBody = JSON.stringify(payload); }
  }
  return fetch(`${process.env.VITE_SUPABASE_URL.replace(/\/$/, '')}${path}`, {
    method, headers, body: requestBody, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let auth;
  try { auth = await authenticate(bearer(req)); }
  catch { return res.status(401).json({ error: 'Session expired or revoked. Sign in again.' }); }
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') throw new AccessDenied('Invalid request');
    const upstream = await dataRequest(body, auth);
    return res.status(200).json({ status: upstream.status, body: await upstream.text(),
      headers: { 'content-type': upstream.headers.get('content-type') || 'application/json',
        ...(upstream.headers.get('content-range') ? { 'content-range': upstream.headers.get('content-range') } : {}) } });
  } catch (error) {
    return res.status(error.status || 502).json({ error: error.status ? error.message : 'Data service unavailable. Please retry.' });
  }
}
