import { spawnSync } from "node:child_process";

const tests = [
  "test/guild-territory-attack-mariadb.integration.test.ts",
  "test/guild-territory-attack-resilience-mariadb.integration.test.ts",
];

for (const test of tests) {
  const run = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", test], {
    cwd: process.cwd(),
    env: { ...process.env, RUN_MARIADB_INTEGRATION: "true" },
    stdio: "inherit",
  });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
