import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyObjectDbConsumerClassificationDelta, sha256ConsumerSet, type ObjectDbConsumerClassificationDelta } from "../src/data-migration/object-db-consumer-classification-delta.js";
import type { ConsumerManifest } from "../src/data-migration/object-db-consumer-transition-audit.js";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(repoRoot, path), "utf8")) as T;
const base = readJson<ConsumerManifest>("개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json");
const delta = readJson<ObjectDbConsumerClassificationDelta>("개발환경_고도화/migration-control/contracts/object-db-consumer-classification-delta.SCD-20260909-1.v1.json");
if (process.argv.includes("--source-check")) {
  const { buildObjectDbConsumerClassificationDelta } = await import("./build-object-db-consumer-classification-delta.js");
  const expected = buildObjectDbConsumerClassificationDelta();
  if (JSON.stringify(delta) !== JSON.stringify(expected)) throw new Error("OBJECT_DB_CONSUMER_DELTA_NON_DETERMINISTIC");
}
const applied = applyObjectDbConsumerClassificationDelta(base, delta);
const baseById = new Map(base.consumers.map((consumer) => [consumer.consumerId, consumer]));
const changed = applied.consumers.filter((consumer) => JSON.stringify(consumer) !== JSON.stringify(baseById.get(consumer.consumerId)));
if (changed.length !== 78 || changed.some(({ kind, unresolvedDynamicCallCount }) => kind !== "HTTP_WEB_ROUTE" || unresolvedDynamicCallCount !== 0)) {
  throw new Error("OBJECT_DB_CONSUMER_DELTA_APPLY_SCOPE_MISMATCH");
}
if (applied.consumerSetSha256 !== sha256ConsumerSet(applied.consumers) || applied.consumerSetSha256 === base.consumerSetSha256) {
  throw new Error("OBJECT_DB_CONSUMER_DELTA_EFFECTIVE_SET_HASH_MISMATCH");
}
const unresolved = delta.audit.entries.filter(({ resolved }) => !resolved);
if (unresolved.length !== 3 || unresolved.some(({ unresolvedReasons }) => unresolvedReasons.length !== 1)) {
  throw new Error("OBJECT_DB_CONSUMER_DELTA_UNRESOLVED_EVIDENCE_MISMATCH");
}
const receipts = readJson<{ receipts: unknown[] }>("개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave27-v1.json").receipts;
const prefix = JSON.stringify(receipts.slice(0, delta.preservation.wave27PrefixCount));
if (receipts.length !== delta.preservation.receiptCount || Buffer.byteLength(prefix) !== delta.preservation.wave27PrefixBytes
  || createHash("sha256").update(prefix.replace(/\r\n?/g, "\n"), "utf8").digest("hex") !== delta.preservation.wave27PrefixSha256) {
  throw new Error("OBJECT_DB_CONSUMER_DELTA_RECEIPT_PREFIX_DRIFT");
}
const canonicalBytes = readFileSync(resolve(repoRoot, "개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json"));
console.log(JSON.stringify({ status: "PASS", baseConsumers: base.consumers.length, changedConsumers: changed.length,
  unresolvedConsumers: unresolved.length, canonicalManifestSha256: createHash("sha256").update(canonicalBytes).digest("hex"), deltaSha256: delta.deltaSha256 }));
