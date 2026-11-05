import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

process.chdir(new URL('..', import.meta.url).pathname);
for (const task of ['lint', 'type-check', 'check:payments', 'build']) {
  const result = spawnSync('npm', ['run', task], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
}
const handlers = files('api').filter(path => path.endsWith('.js'));
assert(handlers.length <= 12, 'Keep the deployment within the 12-function budget');
for (const path of handlers) {
  const module = await import(resolve(path));
  assert.equal(typeof module.default, 'function', `${path} must export a handler`);
  if (path.startsWith('api/payments/') && !path.endsWith('/return.js')) {
    const response = {
      code: 200,
      setHeader() { return this; },
      status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await module.default({ method: 'POST', headers: {}, body: {} }, response);
    assert.equal(response.code, 401, `${path} must reject unauthenticated requests`);
  }
}
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const fallback = new RegExp(`^${vercel.rewrites.at(-1).source}$`);
assert(fallback.test('/signin-oidc'));
assert(fallback.test('/dashboard'));
assert(!fallback.test('/api/payments/dfccil/return'));
assert(!fallback.test('/api/sso'));
assert(!fallback.test('/assets/app.js'));
assert(!files('dist').some(path => path.endsWith('.map')), 'Do not publish source maps');
const eas = JSON.parse(readFileSync('mobile/eas.json', 'utf8'));
for (const name of ['preview', 'production']) {
  const env = eas.build[name].env;
  assert.equal(env.EXPO_PUBLIC_SSO_BACKEND_URL, 'https://ev-cms-rho.vercel.app/api/sso');
  assert.equal(env.EXPO_PUBLIC_ENABLE_PAYMENT_MOCK, 'false');
  assert.equal(env.EXPO_PUBLIC_PAYMENT_GATEWAY_ENABLED, 'false');
}
console.log(`Deployment checks passed; ${handlers.length} ESM API handlers loaded. Live payments must remain disabled.`);
