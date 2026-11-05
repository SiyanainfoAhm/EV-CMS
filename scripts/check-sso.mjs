import { spawnSync } from 'node:child_process';
const steps = [
  ['--test','tests/sso.test.js','tests/mobile-authorization.test.js'],
  ['mobile/node_modules/typescript/bin/tsc','--noEmit','--project','mobile/tsconfig.json'],
];
for (const args of steps) {
  const result = spawnSync(process.execPath, args, {stdio:'inherit'});
  if (result.status !== 0) process.exit(result.status || 1);
}
