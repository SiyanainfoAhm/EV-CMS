export class AccessDenied extends Error { constructor(message = 'Operation not permitted') { super(message); this.status = 403; } }
export const ownTables = new Set(['EV_ChargingSessions','EV_Payments','EV_RFIDCards','EV_SupportTickets','EV_Notifications','EV_UserPushTokens','EV_UserPreferences']);
const sharedTables = new Set(['EV_Chargers','EV_ChargerConnectors','EV_Tariffs','EV_PrepaidPlans']);
const relations = {
  EV_ChargingSessions: { EV_Chargers: true, EV_Users: new Set(['full_name']) },
  EV_Chargers: { EV_ChargerConnectors: true },
  EV_Payments: { EV_Receipts: true, EV_ChargingSessions: true },
};
const sharedColumns = {
  EV_Chargers: 'id,charge_point_id,name,display_name,manufacturer,model,charger_type,max_power_kw,status,location,latitude,longitude,is_simulated,tariff_id,allow_admin_bypass,last_heartbeat_at,created_at,updated_at',
  EV_ChargerConnectors: 'id,charger_id,connector_id,connector_type,max_power_kw,status',
};
// A small select grammar: identifiers, root wildcard and approved relationship trees.
// Aliases, casts, arbitrary nested relations and private user fields are rejected.
export function safeSelect(text, table, depth = 0) {
  if (depth > 3 || typeof text !== 'string' || text.length > 3000) throw new AccessDenied('Invalid selection');
  let pos = 0; const result = [];
  while (pos < text.length) {
    while (/\s/.test(text[pos] || '') && pos < text.length) pos++;
    const match = /^(\*|[A-Za-z_][A-Za-z0-9_]*)/.exec(text.slice(pos));
    if (!match) throw new AccessDenied('Invalid selection');
    const name = match[0]; pos += name.length;
    while (/\s/.test(text[pos] || '') && pos < text.length) pos++;
    if (text[pos] === '(') {
      const allowed = relations[table]?.[name];
      if (!allowed) throw new AccessDenied('Relationship is not exposed');
      const start = ++pos; let nesting = 1;
      while (pos < text.length && nesting) { if (text[pos] === '(') nesting++; if (text[pos] === ')') nesting--; if (nesting) pos++; }
      if (nesting) throw new AccessDenied('Invalid selection');
      const inner = safeSelect(text.slice(start, pos), name, depth + 1); pos++;
      if (allowed instanceof Set && inner.split(',').some(field => !allowed.has(field))) throw new AccessDenied('Private fields are not exposed');
      result.push(`${name}(${inner})`);
    } else {
      if (table === 'EV_Users' && name !== 'full_name') throw new AccessDenied('Private fields are not exposed');
      if (sharedColumns[table] && name !== '*' && !sharedColumns[table].split(',').includes(name)) throw new AccessDenied('Private charger fields are not exposed');
      result.push(name === '*' && sharedColumns[table] ? sharedColumns[table] : name);
    }
    while (/\s/.test(text[pos] || '') && pos < text.length) pos++;
    if (pos === text.length) break;
    if (text[pos++] !== ',' || pos === text.length) throw new AccessDenied('Invalid selection');
  }
  if (!result.length) throw new AccessDenied('Empty selection');
  return result.join(',');
}
export function secureQuery(rawPath, method, user) {
  if (typeof rawPath !== 'string' || !rawPath.startsWith('/rest/v1/') || /[\\#]/.test(rawPath)) throw new AccessDenied('Invalid data path');
  const url = new URL(rawPath, 'https://database.invalid');
  const table = decodeURIComponent(url.pathname.slice('/rest/v1/'.length));
  if (!/^[A-Za-z_]+$/.test(table) || (!ownTables.has(table) && !sharedTables.has(table) && table !== 'EV_SystemConfig')) throw new AccessDenied('Table is not exposed');
  const params = url.searchParams;
  // PostgreSQL public schema only. Query predicates can narrow, never replace ownership.
  params.set('select', safeSelect(params.get('select') || '*', table));
  if (ownTables.has(table)) {
    const occupancy = table === 'EV_ChargingSessions' && ['GET','HEAD'].includes(method) &&
      params.get('select') === 'connector_id' && params.get('status') === 'eq.active' &&
      /^eq\.[0-9a-f-]{36}$/.test(params.get('charger_id') || '');
    const adminMonitor = user.role === 'SuperAdmin' && ['GET','HEAD'].includes(method) && ['EV_ChargingSessions','EV_Payments'].includes(table);
    if (occupancy) {
      // Occupancy is public charger state, not a way to test a named user's location.
      for (const key of [...params.keys()]) if (!['select','status','charger_id','limit'].includes(key)) params.delete(key);
    } else if (!adminMonitor) params.set('user_id', `eq.${user.id}`);
  }
  if (table === 'EV_SystemConfig') {
    if (params.get('key') !== 'eq.default_site_location' || !['GET','HEAD'].includes(method)) throw new AccessDenied('Private configuration is not exposed');
    params.set('select', 'value');
  }
  if (sharedTables.has(table) && !['GET','HEAD'].includes(method)) throw new AccessDenied('Shared data is read-only');
  // Range headers are not accepted: bound requests server-side.
  if (['GET','HEAD'].includes(method)) {
    const limit = Number(params.get('limit') || 100);
    params.set('limit', String(Math.max(1, Math.min(Number.isFinite(limit) ? limit : 100, 500))));
  } else {
    params.delete('limit'); params.delete('offset');
  }
  return { url, table };
}
export function secureWrite(table, method, value, user) {
  const allowed = {
    EV_Notifications: ['read'],
    EV_SupportTickets: ['id','subject','description','priority','category','attachments','updated_at'],
    EV_UserPushTokens: ['token','token_type','platform','device_name','is_active','last_seen_at','updated_at'],
    EV_RFIDCards: ['status','updated_at'],
  };
  if (method === 'DELETE' || !allowed[table] || !['POST','PATCH'].includes(method)) throw new AccessDenied('This mutation requires a trusted server operation');
  const rows = Array.isArray(value) ? value : [value];
  if (rows.length !== 1) throw new AccessDenied('Batch mutations are not exposed');
  return rows.map(row => {
    if (!row || typeof row !== 'object') throw new AccessDenied('Invalid payload');
    if (row.user_id !== undefined && row.user_id !== user.id && !(table === 'EV_RFIDCards' && row.user_id === null && method === 'PATCH')) throw new AccessDenied('Cannot change another user');
    const result = {};
    for (const [key, val] of Object.entries(row)) {
      if (key === 'user_id') continue;
      if (!allowed[table].includes(key)) throw new AccessDenied(`Field ${key} requires a trusted server operation`);
      result[key] = val;
    }
    if (table === 'EV_RFIDCards') {
      if (method === 'POST') throw new AccessDenied('Use the authorized RFID binding operation');
      else if (row.user_id === null) { result.user_id = null; result.status = 'inactive'; }
    } else if (method === 'POST') result.user_id = user.id;
    if (table === 'EV_SupportTickets' && method === 'POST') result.status = 'open';
    return result;
  })[0];
}
