// Wave9 전용 allowlist가 검증된 순위 consumer만 공용 격리 runner로 전달합니다.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED = new Set([
  "runtime-dispatch-465e4b3a15c003dc",
  "runtime-dispatch-9db5e3e6c256b5fa",
  "runtime-dispatch-eaa906ea249408a5",
  "runtime-dispatch-e02f58bf27070ab0",
  "runtime-dispatch-e54fc7fbded287c6",
]);
const args = process.argv.slice(2);
if (args.length !== 3) throw new Error("Wave9 harness arguments missing");
const input = JSON.parse(readFileSync(args[0], "utf8"));
if (!ALLOWED.has(input.binding?.consumerId)) throw new Error("Wave9 consumer not allowlisted");
if (input.invocation?.exportName !== "executeWave9RankChain") throw new Error("Wave9 export drift");
if (!String(input.invocation?.targetPath).endsWith("object-db-executable-parity-wave9-rank-chain.mjs"))
  throw new Error("Wave9 target drift");
const engine = resolve(dirname(fileURLToPath(import.meta.url)), "object-db-executable-parity-wave8-harness.mjs");
const child = spawnSync(process.execPath, [engine, ...args], { stdio: "inherit", timeout: 30_000 });
if (child.error) throw child.error;
if (child.status !== 0) process.exit(child.status ?? 1);
