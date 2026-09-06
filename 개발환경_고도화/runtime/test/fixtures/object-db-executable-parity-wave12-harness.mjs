// Wave12는 글자수 통계 consumer 하나만 공용 격리 runner에 전달합니다.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const args=process.argv.slice(2);if(args.length!==3)throw new Error("Wave12 harness arguments missing");
const input=JSON.parse(readFileSync(args[0],"utf8"));if(input.binding?.consumerId!=="admin-command-96dcd3753578c56c")throw new Error("Wave12 consumer not allowlisted");if(input.invocation?.exportName!=="executeWave12CharacterCount")throw new Error("Wave12 export drift");if(!String(input.invocation?.targetPath).endsWith("object-db-executable-parity-wave12-character-count.mjs"))throw new Error("Wave12 target drift");
const engine=resolve(dirname(fileURLToPath(import.meta.url)),"object-db-executable-parity-wave8-harness.mjs"),child=spawnSync(process.execPath,[engine,...args],{stdio:"inherit",timeout:30_000});if(child.error)throw child.error;if(child.status!==0)process.exit(child.status??1);
