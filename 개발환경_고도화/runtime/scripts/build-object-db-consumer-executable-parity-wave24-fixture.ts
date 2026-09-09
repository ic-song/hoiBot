import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { deriveUniqueClassMethodSourceSpan } from "../src/data-migration/object-db-consumer-transition-audit.js";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");
const fixturePath = resolve(repoRoot, "개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave24-mutations-v1.json");
const manifest = JSON.parse(readFileSync(resolve(repoRoot, "개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json"), "utf8"));
const baseline = manifest.baseCommit as string;
const sha = (value: string): string => createHash("sha256").update(value.replace(/\r\n?/g, "\n"), "utf8").digest("hex");
const read = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8").replace(/\r\n?/g, "\n");

const definitions = [
  {
    consumerId: "sql-repository-87ed81931dd7417b", wbs: "WBS790", className: "CanonicalItemInventoryRepository", methodName: "changeStackQuantity",
    sourcePath: "개발환경_고도화/runtime/src/inventory/canonical-item-inventory-repository.ts", namePrefix: "hoibot_wave24_item_stack_quantity_",
    allowedTables: ["canonical_owned_item_stacks", "canonical_item_inventory_operations", "canonical_item_inventory_ledger_entries"],
    runtimeSourcePaths: ["개발환경_고도화/runtime/src/inventory/canonical-item-inventory-repository.ts", "개발환경_고도화/runtime/src/database.ts", "개발환경_고도화/runtime/src/shared/maria-database-error-policy.ts", "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave24-target.mjs", "개발환경_고도화/runtime/migrations/443_object_identity_audit_provider.sql", "개발환경_고도화/runtime/migrations/444_canonical_item_inventory.sql", "개발환경_고도화/runtime/migrations/490_item_bag_import_baseline_ordering.sql"],
  },
] as const;

const kinds = ["MUTATION_SUCCESS", "DOMAIN_FAILURE_ROLLBACK", "DUPLICATE_REPLAY_DML_ZERO", "PAYLOAD_DRIFT_FAIL_CLOSED", "RESTART_REPLAY", "CONCURRENCY_SINGLE_WRITER"] as const;
const previous = (() => { try { return JSON.parse(readFileSync(fixturePath, "utf8")); } catch { return undefined; } })();
const cases = definitions.map((definition) => {
  const consumer = manifest.consumers.find((candidate: { consumerId: string }) => candidate.consumerId === definition.consumerId);
  if (!consumer) throw new Error(`Wave24 manifest consumer missing: ${definition.consumerId}`);
  const source = read(definition.sourcePath);
  const span = deriveUniqueClassMethodSourceSpan(source, definition.className, definition.methodName);
  const catalogSource = execFileSync("git", ["show", `${baseline}:${definition.sourcePath}`], { cwd: repoRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).replace(/\r\n?/g, "\n");
  const relocation = execFileSync("git", ["diff", "--no-ext-diff", "--unified=0", baseline, "HEAD", "--", definition.sourcePath], { cwd: repoRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).replace(/\r\n?/g, "\n");
  const old = previous?.cases?.find((candidate: { consumerId: string }) => candidate.consumerId === definition.consumerId);
  return {
    consumerId: definition.consumerId,
    wbs: definition.wbs,
    sourceMethod: { className: definition.className, methodName: definition.methodName },
    runtimeSourcePaths: definition.runtimeSourcePaths,
    mutationContract: {
      format: "hoibot-object-db-consumer-mutation-evidence-v1",
      consumerId: definition.consumerId,
      source: { path: definition.sourcePath, sha256: sha(source), spanStart: span.start, spanEnd: span.end, spanSha256: span.sha256, catalogSpanStart: consumer.sourceSpan.start, catalogSpanEnd: consumer.sourceSpan.end, catalogSpanSha256: consumer.sourceSpan.sha256, relocationDiffSha256: sha(relocation) },
      database: { host: "127.0.0.1", forbiddenPort: 3306, namePrefix: definition.namePrefix },
      allowedTables: definition.allowedTables,
      scenarios: old?.mutationContract?.scenarios ?? [],
    },
    bindings: kinds.map((scenarioKind) => ({ consumerId: definition.consumerId, scenarioId: `scenario:wave24:${definition.consumerId}:${scenarioKind.toLowerCase()}`, scenarioKind, exportName: "executeWave24Mutation", harnessCaseId: `case:wave24:${definition.consumerId}` })),
    sealedObservations: old?.sealedObservations ?? [],
  };
});

const fixture = { format: "hoibot-object-db-consumer-parity-case-fixture-v1", fixtureId: "fixture:object-db-executable-parity:wave24:mutations:v1", sliceId: "WBS791", consumerIds: definitions.map(({ consumerId }) => consumerId).sort(), receiptContract: { version: "WBS791_WAVE24_MUTATION_DIRECT_V1", transaction: "MUTATION", externalNetworkCalls: 0, replyCalls: 0, restart: "DISTINCT_NODE_CHILD_PROCESSES", concurrency: "EXACTLY_ONE_COMMITTED_WRITER", locatorProjectionMode: "RAW_COMPOSITE_DB_PROJECTION" }, shadowContract: previous?.shadowContract ?? { mode: "ROLLBACK_ONLY_ACTUAL_CONSUMER", route: "SHADOW", expectedCommittedRowCount: 0, externalNetworkCalls: 0, replyCalls: 0 }, shadowObservation: previous?.shadowObservation ?? null, cases };
writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ fixturePath, consumers: cases.length, scenarios: cases.reduce((sum, value) => sum + value.sealedObservations.length, 0) }));
