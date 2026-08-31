import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const runtimeRoot = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync(process.execPath, [
  "--import", "tsx", "--test", "test/package-free-market-membership-reward-binding-mariadb.integration.test.ts",
], {
  cwd: runtimeRoot,
  env: { ...process.env, PACKAGE_FREE_MARKET_MEMBERSHIP_MARIADB_TEST: "true" },
  encoding: "utf8",
});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (result.status !== 0) throw new Error(`PACKAGE_FREE_MARKET_MEMBERSHIP_SHADOW_FAILED:${result.status ?? "signal"}`);
process.stdout.write("package-free-market-membership-shadow normal=1 replay=1 repeat=1 rollback=1 reconnect=1 legacy-ownership-write=0\n");
