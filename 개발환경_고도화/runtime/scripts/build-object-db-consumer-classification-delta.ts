import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditHttpRouteCompositionBindings } from "../src/data-migration/http-route-composition-binding-audit.js";
import {
  sealObjectDbConsumerClassificationDelta, sha256CanonicalJson,
  type ObjectDbConsumerClassificationDelta,
} from "../src/data-migration/object-db-consumer-classification-delta.js";
import { deriveConsumerManifest, type ConsumerManifest } from "../src/data-migration/object-db-consumer-transition-audit.js";
import { extractHttpRouteSurface } from "../src/data-migration/http-route-surface-audit.js";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");
const manifestPath = resolve(repoRoot, "개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json");
const outputPath = resolve(repoRoot, "개발환경_고도화/migration-control/contracts/object-db-consumer-classification-delta.SCD-20260909-1.v1.json");
const receiptsPath = resolve(repoRoot, "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave27-v1.json");

function knownSqlTables(): Set<string> {
  const migrationRoot = resolve(runtimeRoot, "migrations");
  return new Set(readdirSync(migrationRoot).filter((name) => name.endsWith(".sql")).flatMap((name) =>
    [...readFileSync(resolve(migrationRoot, name), "utf8").matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`?([a-z][a-z0-9_]*)`?/gi)]
      .map((match) => match[1]!)));
}

export function buildObjectDbConsumerClassificationDelta(): ObjectDbConsumerClassificationDelta {
  const base = JSON.parse(readFileSync(manifestPath, "utf8")) as ConsumerManifest;
  const candidate = deriveConsumerManifest(repoRoot, base.baseCommit);
  const baseIdSha = sha256CanonicalJson(base.consumers.map(({ consumerId }) => consumerId).sort());
  const candidateIdSha = sha256CanonicalJson(candidate.consumers.map(({ consumerId }) => consumerId).sort());
  if (candidate.consumers.length !== base.consumers.length || candidateIdSha !== baseIdSha) {
    throw new Error(`OBJECT_DB_CONSUMER_DELTA_CANDIDATE_ID_SET_DRIFT:base=${base.consumers.length}/${baseIdSha}:candidate=${candidate.consumers.length}/${candidateIdSha}`);
  }
  const endpoints = extractHttpRouteSurface({ runtimeRoot }).endpoints;
  const audit = auditHttpRouteCompositionBindings({ repoRoot, runtimeRoot, endpoints, knownSqlTables: knownSqlTables() });
  const baseById = new Map(base.consumers.map((consumer) => [consumer.consumerId, consumer]));
  const candidateByKey = new Map(candidate.consumers.filter(({ kind }) => kind === "HTTP_WEB_ROUTE")
    .map((consumer) => [consumer.triggerOrPredicate, consumer]));
  const operations = audit.filter(({ resolved }) => resolved).map((evidence) => {
    const after = candidateByKey.get(evidence.endpointKey);
    const before = after === undefined ? undefined : baseById.get(after.consumerId);
    if (before === undefined || after === undefined) throw new Error(`OBJECT_DB_CONSUMER_DELTA_ROUTE_MISSING:${evidence.endpointKey}`);
    return {
      operation: "REPLACE" as const, consumerId: after.consumerId,
      beforeSha256: sha256CanonicalJson(before), afterSha256: sha256CanonicalJson(after), before, after,
    };
  }).sort((left, right) => left.consumerId.localeCompare(right.consumerId));
  const groups = Object.entries(Object.groupBy(audit, ({ registrar }) => registrar)).sort(([left], [right]) => left.localeCompare(right));
  const receiptBundle = JSON.parse(readFileSync(receiptsPath, "utf8")) as { receipts: unknown[] };
  const prefix = JSON.stringify(receiptBundle.receipts.slice(0, 324));
  const prefixSha = createHash("sha256").update(prefix.replace(/\r\n?/g, "\n"), "utf8").digest("hex");
  if (receiptBundle.receipts.length !== 352 || Buffer.byteLength(prefix) !== 1260829
    || prefixSha !== "72522ab348255c339dc2e4918fac6ab1702643e6ba8725b99e74ab3457b35adb") {
    throw new Error("OBJECT_DB_CONSUMER_DELTA_RECEIPT_PREFIX_DRIFT");
  }
  return sealObjectDbConsumerClassificationDelta({
    format: "hoibot-object-db-consumer-classification-delta-v1",
    evidenceSchemaVersion: "object-db-consumer-delta-v1",
    baseCatalogVersion: "SC-20260902-1",
    deltaId: "SCD-20260909-1",
    sourceManifest: { consumerCount: base.consumers.length, consumerSetSha256: base.consumerSetSha256,
      consumerIdSetSha256: baseIdSha, nonHttpConsumersSha256: sha256CanonicalJson(base.consumers.filter(({ kind }) => kind !== "HTTP_WEB_ROUTE")),
      sha256: sha256CanonicalJson(base) },
    scope: { kind: "HTTP_WEB_ROUTE", routeCount: audit.length, registrarCounts: Object.fromEntries(groups.map(([registrar, entries]) => [registrar, entries!.length])) },
    audit: {
      resolvedCount: audit.filter(({ resolved }) => resolved).length,
      unresolvedCount: audit.filter(({ resolved }) => !resolved).length,
      registrarResults: groups.map(([registrar, entries]) => ({
        registrar, total: entries!.length, resolved: entries!.filter(({ resolved }) => resolved).length,
        unresolved: entries!.filter(({ resolved }) => !resolved).length,
        reasons: Object.fromEntries(Object.entries(Object.groupBy(entries!.flatMap(({ unresolvedReasons }) => unresolvedReasons), (reason) => reason))
          .sort(([left], [right]) => left.localeCompare(right)).map(([reason, occurrences]) => [reason, occurrences!.length])),
      })),
      entries: audit,
    },
    operations,
    preservation: { receiptCount: 352, wave27PrefixCount: 324, wave27PrefixBytes: 1260829, wave27PrefixSha256: "72522ab348255c339dc2e4918fac6ab1702643e6ba8725b99e74ab3457b35adb" },
  });
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const delta = buildObjectDbConsumerClassificationDelta();
  writeFileSync(outputPath, `${JSON.stringify(delta, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output: outputPath, routes: delta.scope.routeCount, resolved: delta.audit.resolvedCount, unresolved: delta.audit.unresolvedCount, operations: delta.operations.length, sha256: delta.deltaSha256 }));
}
