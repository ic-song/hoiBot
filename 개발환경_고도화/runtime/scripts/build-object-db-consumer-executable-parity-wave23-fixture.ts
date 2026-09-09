import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { deriveUniqueClassMethodSourceSpan } from "../src/data-migration/object-db-consumer-transition-audit.js";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");
const fixturePath = resolve(repoRoot, "개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave23-mutations-v1.json");
const manifest = JSON.parse(readFileSync(resolve(repoRoot, "개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json"), "utf8"));
const baseline = manifest.baseCommit as string;
const sha = (value: string): string => createHash("sha256").update(value.replace(/\r\n?/g, "\n"), "utf8").digest("hex");
const read = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8").replace(/\r\n?/g, "\n");

const definitions = [
  {
    consumerId: "sql-repository-818137c4fb22037a", wbs: "WBS787", className: "MariaCanonicalFurnitureHomeRepository", methodName: "placeOwnedFurniture",
    sourcePath: "개발환경_고도화/runtime/src/home/canonical-furniture-home-repository.ts", namePrefix: "hoibot_wbs787_furniture_place_2615",
    allowedTables: ["object_owned_furniture_instances", "object_home_furniture_placements", "object_furniture_operation_replays", "object_furniture_ownership_history"],
    runtimeSourcePaths: ["개발환경_고도화/runtime/src/home/canonical-furniture-home-repository.ts", "개발환경_고도화/runtime/src/database.ts", "개발환경_고도화/runtime/src/shared/maria-database-error-policy.ts", "개발환경_고도화/runtime/test/fixtures/canonical-furniture-place-targeted.mjs", "개발환경_고도화/runtime/migrations/443_object_identity_audit_provider.sql", "개발환경_고도화/runtime/migrations/444_canonical_item_inventory.sql", "개발환경_고도화/runtime/migrations/445_object_furniture_home_canonical_model.sql"],
  },
  {
    consumerId: "sql-repository-f6c531148a436a21", wbs: "WBS788", className: "MariaCanonicalMiniPetRepository", methodName: "acquire",
    sourcePath: "개발환경_고도화/runtime/src/mini-pet/canonical-mini-pet-repository.ts", namePrefix: "hoibot_wave23_mini_pet_acquire_",
    allowedTables: ["canonical_owned_mini_pet_instances", "canonical_mini_pet_operation_replays"],
    runtimeSourcePaths: ["개발환경_고도화/runtime/src/mini-pet/canonical-mini-pet-repository.ts", "개발환경_고도화/runtime/src/database.ts", "개발환경_고도화/runtime/src/shared/maria-database-error-policy.ts", "개발환경_고도화/runtime/src/identity/object-identity-audit-provider.ts", "개발환경_고도화/runtime/migrations/443_object_identity_audit_provider.sql", "개발환경_고도화/runtime/migrations/444_canonical_item_inventory.sql", "개발환경_고도화/runtime/migrations/447_canonical_mini_pet.sql"],
  },
  {
    consumerId: "sql-repository-31c4099080d9c9c1", wbs: "WBS789", className: "MariaCanonicalPetSkillRepository", methodName: "grant",
    sourcePath: "개발환경_고도화/runtime/src/pet/maria-canonical-pet-skill-repository.ts", namePrefix: "hoibot_wbs789_pet_skill_grant_2617",
    allowedTables: ["canonical_owned_pet_skill_stacks", "canonical_pet_skill_operation_replays"],
    runtimeSourcePaths: ["개발환경_고도화/runtime/src/pet/maria-canonical-pet-skill-repository.ts", "개발환경_고도화/runtime/src/pet/canonical-pet-skill-handler-registry.ts", "개발환경_고도화/runtime/src/database.ts", "개발환경_고도화/runtime/src/shared/maria-database-error-policy.ts", "개발환경_고도화/runtime/src/identity/object-identity-audit-provider.ts", "개발환경_고도화/runtime/test/fixtures/canonical-pet-skill-grant-targeted.mjs", "개발환경_고도화/runtime/migrations/443_object_identity_audit_provider.sql", "개발환경_고도화/runtime/migrations/444_canonical_item_inventory.sql", "개발환경_고도화/runtime/migrations/446_canonical_pet_equipment.sql", "개발환경_고도화/runtime/migrations/449_canonical_pet_skill.sql"],
  },
] as const;

const kinds = ["MUTATION_SUCCESS", "DOMAIN_FAILURE_ROLLBACK", "DUPLICATE_REPLAY_DML_ZERO", "PAYLOAD_DRIFT_FAIL_CLOSED", "RESTART_REPLAY", "CONCURRENCY_SINGLE_WRITER"] as const;
const previous = (() => { try { return JSON.parse(readFileSync(fixturePath, "utf8")); } catch { return undefined; } })();
const cases = definitions.map((definition) => {
  const consumer = manifest.consumers.find((candidate: { consumerId: string }) => candidate.consumerId === definition.consumerId);
  if (!consumer) throw new Error(`Wave23 manifest consumer missing: ${definition.consumerId}`);
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
    bindings: kinds.map((scenarioKind) => ({ consumerId: definition.consumerId, scenarioId: `scenario:wave23:${definition.consumerId}:${scenarioKind.toLowerCase()}`, scenarioKind, exportName: "executeWave23Mutation", harnessCaseId: `case:wave23:${definition.consumerId}` })),
    sealedObservations: old?.sealedObservations ?? [],
  };
});

const fixture = { format: "hoibot-object-db-consumer-parity-case-fixture-v1", fixtureId: "fixture:object-db-executable-parity:wave23:mutations:v1", sliceId: "WBS791", consumerIds: definitions.map(({ consumerId }) => consumerId).sort(), receiptContract: { version: "WBS791_WAVE23_MUTATION_DIRECT_V1", transaction: "MUTATION", externalNetworkCalls: 0, replyCalls: 0, restart: "DISTINCT_NODE_CHILD_PROCESSES", concurrency: "EXACTLY_ONE_COMMITTED_WRITER", locatorProjectionMode: "RAW_COMPOSITE_DB_PROJECTION" }, cases };
writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ fixturePath, consumers: cases.length, scenarios: cases.reduce((sum, value) => sum + value.sealedObservations.length, 0) }));
