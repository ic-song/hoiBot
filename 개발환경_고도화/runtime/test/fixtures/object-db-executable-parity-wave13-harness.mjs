import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname,resolve } from "node:path";
import { fileURLToPath } from "node:url";
const args=process.argv.slice(2);if(args.length!==3)throw new Error("Wave13 harness arguments missing");const input=JSON.parse(readFileSync(args[0],"utf8"));if(input.binding?.consumerId!=="admin-command-5e04d0767d4c2abc")throw new Error("Wave13 consumer not allowlisted");if(input.invocation?.exportName!=="executeWave13ServerStats")throw new Error("Wave13 export drift");if(!String(input.invocation?.targetPath).endsWith("object-db-executable-parity-wave13-server-stats.mjs"))throw new Error("Wave13 target drift");const engine=resolve(dirname(fileURLToPath(import.meta.url)),"object-db-executable-parity-wave8-harness.mjs"),child=spawnSync(process.execPath,[engine,...args],{stdio:"inherit",timeout:30_000});if(child.error)throw child.error;if(child.status!==0)process.exit(child.status??1);
