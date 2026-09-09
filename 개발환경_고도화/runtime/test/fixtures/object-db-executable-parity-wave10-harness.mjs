// Wave10 전용 allowlist가 검증된 펜던트 조회 consumer만 공용 격리 runner로 전달합니다.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED = new Set([
  "runtime-dispatch-36d6721ade0707a6",
  "runtime-dispatch-8c6c3c3d598fe078",
  "runtime-dispatch-19076db78c2eefb9",
]);
const args = process.argv.slice(2);
if (args.length !== 3) throw new Error("Wave10 harness arguments missing");
const input = JSON.parse(readFileSync(args[0], "utf8"));
if (!ALLOWED.has(input.binding?.consumerId)) throw new Error("Wave10 consumer not allowlisted");
if (input.invocation?.exportName !== "executeWave10PendantRead") throw new Error("Wave10 export drift");
if (!String(input.invocation?.targetPath).endsWith("object-db-executable-parity-wave10-pendant-read.mjs"))
  throw new Error("Wave10 target drift");
const engine = resolve(dirname(fileURLToPath(import.meta.url)), "object-db-executable-parity-wave8-harness.mjs");
const child = spawnSync(process.execPath, [engine, ...args], { stdio: "inherit", timeout: 30_000 });
if (child.error) throw child.error;
if (child.status !== 0) process.exit(child.status ?? 1);
