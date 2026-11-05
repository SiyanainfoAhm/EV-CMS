import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { authenticate, tokenHash } from '../server/sso/sessions.js';
import { secureQuery, secureWrite, safeSelect } from '../server/sso/data-policy.js';
import { rpcBody, storagePolicy, dataRequest } from '../api/mobile.js';
import { administer } from '../server/sso/administration.js';
const user = { id: '11111111-1111-4111-8111-111111111111', role: 'User' };
const admin = { ...user, role: 'SuperAdmin' };
const other = '22222222-2222-4222-8222-222222222222';
const subject = 'cdab677d-fa11-480b-baf7-6806ade66186';

test('ownership is imposed independently of client filters and duplicate parameters', () => {
  const { url } = secureQuery(`/rest/v1/EV_Payments?user_id=eq.${other}&user_id=neq.${user.id}&or=(user_id.eq.${other})`, 'GET', user);
  assert.deepEqual(url.searchParams.getAll('user_id'), [`eq.${user.id}`]);
  assert.equal(url.searchParams.get('limit'), '100');
});
test('only full administrators can monitor all sessions; writes remain scoped', () => {
  assert.equal(secureQuery('/rest/v1/EV_ChargingSessions', 'GET', admin).url.searchParams.get('user_id'), null);
  assert.equal(secureQuery('/rest/v1/EV_ChargingSessions', 'PATCH', admin).url.searchParams.get('user_id'), `eq.${user.id}`);
  assert.equal(secureQuery('/rest/v1/EV_ChargingSessions', 'GET', {...user, role:'SiteAdmin'}).url.searchParams.get('user_id'), `eq.${user.id}`);
});
test('connector occupancy exposes no session or user identifiers', () => {
  assert.equal(secureQuery('/rest/v1/EV_ChargingSessions?select=connector_id&status=eq.active&charger_id=eq.33333333-3333-4333-8333-333333333333', 'GET', user).url.searchParams.get('user_id'), null);
  assert.equal(secureQuery('/rest/v1/EV_ChargingSessions?select=connector_id,id&status=eq.active', 'GET', user).url.searchParams.get('user_id'), `eq.${user.id}`);
});
for (const path of ['/rest/v1/EV_Users','/rest/v1/EV_UserSessions','/rest/v1/EV_AuditLogs','/rest/v1/EV_SystemConfig?key=eq.payment_secret','https://attacker.test/rest/v1/EV_Payments','/rest/v1/EV_Payments#x']) {
  test(`denies private or malformed path ${path}`, () => assert.throws(() => secureQuery(path,'GET',user)));
}
test('shared tables cannot be changed', () => assert.throws(() => secureQuery('/rest/v1/EV_Tariffs','PATCH',admin)));
test('safe nested receipt selection is supported', () => {
  assert.equal(safeSelect('id, EV_Receipts ( receipt_number ), EV_ChargingSessions ( energy_kwh, EV_Chargers ( name ) )','EV_Payments'), 'id,EV_Receipts(receipt_number),EV_ChargingSessions(energy_kwh,EV_Chargers(name))');
});
for (const select of ['*,EV_Users(*)','id,EV_Users(password_hash)','id,EV_UserSessions(*)','id,alias:EV_Users(full_name)','id::text','id,EV_Chargers(EV_Users(full_name))','id,EV_Users(full_name, salt)']) {
  test(`rejects unsafe projection ${select}`, () => assert.throws(() => safeSelect(select,'EV_ChargingSessions')));
}
test('wildcard charger projection expands to a safe set of columns', () => assert.ok(!safeSelect('*','EV_Chargers').includes('*')));
test('user fields cannot change ownership or role', () => {
  assert.throws(() => secureWrite('EV_SupportTickets','PATCH',{user_id:other},user));
  assert.throws(() => secureWrite('EV_SupportTickets','PATCH',{role:'SuperAdmin'},user));
  assert.equal(secureWrite('EV_SupportTickets','POST',{subject:'Help'},user).user_id,user.id);
});
for (const [table,payload] of [['EV_Payments',{status:'success'}],['EV_ChargingSessions',{amount_due:0}],['EV_ChargingSessions',{payment_status:'paid'}],['EV_ChargingSessions',{rate_per_kwh_snapshot:0}]]) {
  test(`rejects forged financial update ${table} ${Object.keys(payload)[0]}`, () => assert.throws(() => secureWrite(table,'PATCH',payload,user)));
}
test('unsupported/batch writes and negative charging limits are rejected', () => {
  assert.throws(() => secureWrite('EV_Notifications','DELETE',{},user));
  assert.throws(() => secureWrite('EV_SupportTickets','POST',[{},{}],user));
  assert.throws(() => secureWrite('EV_ChargingSessions','PATCH',{target_kwh:-1},user));
});
test('RPC uses authenticated identity and rejects arbitrary functions/arguments', () => {
  assert.deepEqual(rpcBody('get_ev_user_profile',{},user), {p_user_id:user.id});
  assert.throws(() => rpcBody('get_ev_user_profile',{p_user_id:other},user));
  assert.throws(() => rpcBody('update_ev_user_profile',{p_role:'SuperAdmin'},user));
  assert.throws(() => rpcBody('resolve_ev_user_for_sso',{p_sso_sub:subject},user));
});
test('storage rejects cross-user paths, traversal and deletes', () => {
  assert.throws(() => storagePolicy(`/storage/v1/object/ev-media/EV/${other}/avatar.png`,'POST','x',user));
  assert.throws(() => storagePolicy(`/storage/v1/object/ev-media/EV/${user.id}/%2e%2e/other`,'POST','x',user));
  assert.throws(() => storagePolicy('/storage/v1/object/ev-media','DELETE',{prefixes:[`EV/${other}/avatar.png`]},user));
  assert.deepEqual(storagePolicy(`/storage/v1/object/sign/ev-media/EV/${user.id}/avatar.png`,'POST',{expiresIn:999999},user), {expiresIn:300});
});
test('provisioning and admin revocation require server-verified administrator role', async () => {
  await assert.rejects(administer({action:'admin-users'},{user},{}));
  await assert.rejects(administer({action:'admin-provision',role:'SuperAdmin'},{user},{}));
});

function sessionDatabase(row, account) {
  return { from(table) { const query = { select(){return this;},eq(){return this;},async maybeSingle(){return {data: table === 'EV_UserSessions' ? row : account,error:null};} }; return query; } };
}
const key = new TextEncoder().encode('a-test-only-signing-key-at-least-32-bytes-long');
async function applicationToken() {
  return new SignJWT({virtualId:subject}).setProtectedHeader({alg:'HS256'}).setIssuer('ev-cms-sso')
    .setAudience('ev-cms-mobile').setSubject(user.id).setJti('session-id').setIssuedAt().setExpirationTime('5m').sign(key);
}
test('stored sessions are required and checked on every request', async () => {
  const token = await applicationToken();
  const row = {id:'session-id',user_id:user.id,token_hash:tokenHash(token),expires_at:new Date(Date.now()+300000).toISOString(),revoked_at:null};
  const account = { id:user.id,full_name:'Test User',email:'user@example.test',role:'User',status:'active' };
  assert.equal((await authenticate(token,sessionDatabase(row,account),key)).user.id,user.id);
  for (const invalidRow of [null,{...row,revoked_at:new Date().toISOString()},{...row,token_hash:'forged'},{...row,user_id:other},{...row,expires_at:'invalid'},{...row,expires_at:new Date(0).toISOString()}]) {
    await assert.rejects(authenticate(token,sessionDatabase(invalidRow,account),key));
  }
  await assert.rejects(authenticate(token,sessionDatabase(row,{...account,status:'suspended'}),key));
  const changed = await authenticate(token,sessionDatabase(row,{...account,role:'SuperAdmin'}),key);
  assert.equal(changed.user.role,'SuperAdmin');
});
test('unknown routes and unsafe upserts are denied before any upstream request', async () => {
  await assert.rejects(dataRequest({path:'/rest/v1/EV_Payments',method:'POST',payload:{status:'success'}},{user},{}));
  await assert.rejects(dataRequest({path:'/rest/v1/EV_SupportTickets?on_conflict=id',method:'POST',payload:{subject:'x'},prefer:'resolution=merge-duplicates'},{user},{}));
  await assert.rejects(dataRequest({path:'/functions/v1/arbitrary-function',method:'POST',payload:{}},{user},{}));
});

test('session revocation scopes database updates to the verified user', async () => {
  const { revokeSession } = await import('../server/sso/sessions.js');
  const predicates = [];
  const db = {from(table) { assert.equal(table,'EV_UserSessions'); return { update(value) {assert.ok(value.revoked_at); return this;},eq(column,value){predicates.push([column,value]);return this;},then(resolve){resolve({error:null});} };}};
  await revokeSession({user,claims:{jti:'session-id'}},false,db);
  assert.deepEqual(predicates,[['user_id',user.id],['id','session-id']]);
  predicates.length = 0;
  await revokeSession({user,claims:{jti:'session-id'}},true,db);
  assert.deepEqual(predicates,[['user_id',user.id]]);
});
test('gateway endpoints reject direct anonymous access and missing configuration', async () => {
  const {requireEVCmsBackend} = await import('../deployment/ocpp-auth.js');
  const old = process.env.OCPP_GATEWAY_API_KEY;
  const response = {status(code){this.code=code;return this;},json(){return this;}};
  let called = false;
  try {
    process.env.OCPP_GATEWAY_API_KEY = 'a-gateway-secret-of-at-least-32-bytes';
    requireEVCmsBackend({headers:{}},response,()=>{called=true;});
    assert.equal(response.code,401);assert.equal(called,false);
    requireEVCmsBackend({headers:{authorization:`Bearer ${process.env.OCPP_GATEWAY_API_KEY}`}},response,()=>{called=true;});
    assert.equal(called,true);
  } finally { if(old === undefined) delete process.env.OCPP_GATEWAY_API_KEY; else process.env.OCPP_GATEWAY_API_KEY = old; }
});
test('unsafe charging and foreign payment requests never reach the gateway', async () => {
  const oldUrl = process.env.OCPP_GATEWAY_API_URL, oldKey = process.env.OCPP_GATEWAY_API_KEY;
  try {
    process.env.OCPP_GATEWAY_API_URL='https://gateway.example.test';process.env.OCPP_GATEWAY_API_KEY='test-only';
    await assert.rejects(dataRequest({action:'gateway',operation:'start',payload:{chargePointId:'charger',bypassRfid:true}}, {user},{}));
    await assert.rejects(dataRequest({action:'gateway',operation:'start',payload:{chargePointId:'charger'}}, {user:admin},{}));
    const db = {from(){return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:null,error:null};}};}};
    await assert.rejects(dataRequest({path:'/functions/v1/ev-cms-mobile-session-create-razorpay-order',method:'POST',payload:{session_id:other}},{user},db));
  } finally {
    if(oldUrl === undefined) delete process.env.OCPP_GATEWAY_API_URL;else process.env.OCPP_GATEWAY_API_URL=oldUrl;
    if(oldKey === undefined) delete process.env.OCPP_GATEWAY_API_KEY;else process.env.OCPP_GATEWAY_API_KEY=oldKey;
  }
});
test('mutation requests are not given unsafe PostgREST row limits', () => {
  const {url} = secureQuery('/rest/v1/EV_Notifications?limit=1&offset=10','PATCH',user);
  assert.equal(url.searchParams.has('limit'),false);assert.equal(url.searchParams.has('offset'),false);
});

test('occupancy filters cannot track a particular user', () => {
  const {url} = secureQuery(`/rest/v1/EV_ChargingSessions?select=connector_id&status=eq.active&charger_id=eq.33333333-3333-4333-8333-333333333333&user_id=eq.${other}&or=(user_id.eq.${other})`,'GET',user);
  assert.equal(url.searchParams.has('user_id'),false);
  assert.equal(url.searchParams.has('or'),false);
});

test('RFID binding rejects reserved tags, administrators and already-owned cards', async () => {
  await assert.rejects(dataRequest({action:'rfid-bind',uid:'MOBILE-'+other},{user},{}));
  await assert.rejects(dataRequest({action:'rfid-bind',uid:'ABCDEF12'},{user:admin},{}));
  const db = {from(){return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:{id:other,user_id:other,status:'active'},error:null};}};}};
  await assert.rejects(dataRequest({action:'rfid-bind',uid:'ABCDEF12'},{user},db));
  assert.throws(() => rpcBody('bind_ev_rfid_to_user',{p_user_id:user.id,p_card_id:other},user));
  assert.throws(() => secureWrite('EV_RFIDCards','POST',{uid:'MOBILE-'+other},user));
});
