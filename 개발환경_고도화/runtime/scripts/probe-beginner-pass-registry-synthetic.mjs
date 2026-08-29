import { spawnSync } from "node:child_process";

const required = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"];
const missing = required.filter((name) => process.env[name] === undefined);
if (missing.length > 0) throw new Error(`Missing database probe environment: ${missing.join(", ")}`);

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "test/beginner-pass-registry-mariadb.integration.test.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_INTEGRATION_ENABLED: "true" },
  stdio: "inherit"
});
if (result.error !== undefined) throw result.error;
process.exit(result.status ?? 1);
