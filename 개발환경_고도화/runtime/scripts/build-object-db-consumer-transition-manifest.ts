import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { OBJECT_DB_CONSUMER_BASELINE_COMMIT } from "../src/data-migration/object-db-consumer-baseline.js";
import { deriveConsumerManifest } from "../src/data-migration/object-db-consumer-transition-audit.js";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");
const output = resolve(repoRoot, "개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json");
const manifest = deriveConsumerManifest(repoRoot, OBJECT_DB_CONSUMER_BASELINE_COMMIT);
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, counts: manifest.counts, total: manifest.consumers.length, sha256: manifest.consumerSetSha256 }));
