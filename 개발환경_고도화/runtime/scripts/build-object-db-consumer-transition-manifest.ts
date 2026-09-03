import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveConsumerManifest } from "../src/data-migration/object-db-consumer-transition-audit.js";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");
const output = resolve(repoRoot, "개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json");
const manifest = deriveConsumerManifest(repoRoot, "f97be62292c3f7e8ea79b2d6f302dd25517584d4");
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, counts: manifest.counts, total: manifest.consumers.length, sha256: manifest.consumerSetSha256 }));
