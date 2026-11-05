import { spawnSync } from "node:child_process";
for (const args of [
  [
    "--test",
    "tests/sso.test.js",
    "tests/mobile-authorization.test.js",
    "tests/dfccil-payment.test.js",
    "tests/dfccil-payment-sql.test.js",
  ],
  [
    "mobile/node_modules/typescript/bin/tsc",
    "--noEmit",
    "--project",
    "mobile/tsconfig.json",
  ],
]) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
