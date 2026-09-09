// Wave11 전용 allowlist와 제한시간으로 두 가구 조회 consumer만 공용 격리 runner에 전달합니다.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const ALLOWED=new Set(["runtime-dispatch-722afb15e9cbd92c","runtime-dispatch-c3cb8d18613c2358"]),args=process.argv.slice(2);
if(args.length!==3)throw new Error("Wave11 harness arguments missing");
const input=JSON.parse(readFileSync(args[0],"utf8"));
if(!ALLOWED.has(input.binding?.consumerId))throw new Error("Wave11 consumer not allowlisted");
if(input.invocation?.exportName!=="executeWave11HomeFurnitureRead")throw new Error("Wave11 export drift");
if(!String(input.invocation?.targetPath).endsWith("object-db-executable-parity-wave11-home-furniture-read.mjs"))throw new Error("Wave11 target drift");
const engine=resolve(dirname(fileURLToPath(import.meta.url)),"object-db-executable-parity-wave8-harness.mjs"),child=spawnSync(process.execPath,[engine,...args],{stdio:"inherit",timeout:30_000});
if(child.error)throw child.error;if(child.status!==0)process.exit(child.status??1);
