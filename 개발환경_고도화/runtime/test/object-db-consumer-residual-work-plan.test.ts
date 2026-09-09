import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "../..");
const plan = JSON.parse(readFileSync(resolve(repoRoot, "migration-control/contracts/object-db-consumer-residual-work-plan.v1.json"), "utf8"));

test("checked-in residual plan exactly matches a deterministic rebuild", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/build-object-db-consumer-residual-work-plan.ts", "--check"], {
    cwd: resolve(repoRoot, "runtime"),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("residual work plan freezes every unproven consumer into one actionable category", () => {
  assert.equal(plan.format, "OBJECT_DB_CONSUMER_RESIDUAL_WORK_PLAN_V1");
  assert.equal(plan.catalogVersion, "SC-20260902-1");
  assert.equal(plan.summary.manifestConsumers, 1_133);
  assert.equal(plan.summary.alreadyDirectOrEquivalent, 44);
  assert.equal(plan.summary.residualConsumers, 1_089);
  assert.deepEqual(plan.summary.categoryCounts, {
    A_REUSABLE_PROOF_ASSET: 2,
    B_STRICT_EQUIVALENCE: 10,
    C_DIRECT_EXECUTION: 995,
    D_PREREQUISITE: 82,
  });
  assert.equal(new Set(plan.entries.map((entry: { consumerId: string }) => entry.consumerId)).size, 1_089);
  for (const consumerId of ["sql-repository-818137c4fb22037a", "sql-repository-f6c531148a436a21", "sql-repository-31c4099080d9c9c1"]) {
    assert.equal(plan.entries.some((entry: { consumerId: string }) => entry.consumerId === consumerId), false);
  }
});

test("reuse and equivalence candidates remain explicit and disjoint", () => {
  const reusable = plan.entries.filter((entry: { category: string }) => entry.category === "A_REUSABLE_PROOF_ASSET");
  assert.equal(reusable.length, 2);
  assert.ok(reusable.every((entry: { evidenceCandidate: unknown }) => entry.evidenceCandidate !== null));
  assert.ok(reusable.every((entry: { nextAction: string }) => entry.nextAction === "REEXECUTE_OR_RESEAL_AS_OFFICIAL_RECEIPTS"));
  assert.deepEqual(reusable.map((entry: any) => entry.evidenceCandidate.evidenceKind).sort(), [
    "EVIDENCE_BUNDLE",
    "REUSABLE_HARNESS",
  ]);
  const cohort = plan.equivalenceCohorts[0];
  assert.equal(cohort.ruleId, "SAME_INTERFACE_ACCESS_V1");
  assert.match(cohort.equivalenceKeySha256, /^[a-f0-9]{64}$/);
  assert.equal(cohort.equivalenceKeySha256, createHash("sha256").update(JSON.stringify({
    ruleId: "SAME_INTERFACE_ACCESS_V1",
    interfaceId: "item.admin-grant.execute",
    accessClass: "MUTATION",
  })).digest("hex"));
  assert.equal(cohort.strictProjectionRuleId, "RESIDUAL_STRICT_PROJECTION_V1");
  assert.equal(cohort.strictProjectionSha256, createHash("sha256").update(JSON.stringify({
    ruleId: cohort.strictProjectionRuleId,
    ...cohort.strictProjection,
  })).digest("hex"));
  assert.equal(cohort.sourceSpanSha256, cohort.strictProjection.sourceSpan.sha256);
  assert.equal(cohort.consumerIds.length, 10);
  assert.ok(cohort.consumerIds.every((consumerId: string) =>
    plan.entries.find((entry: { consumerId: string }) => entry.consumerId === consumerId)?.category === "B_STRICT_EQUIVALENCE"));
});

test("blocked dynamic consumers are not counted as complete", () => {
  const blocked = plan.entries.filter((entry: { category: string }) => entry.category === "D_PREREQUISITE");
  assert.equal(blocked.length, 82);
  assert.ok(blocked.every((entry: { nextAction: string }) => entry.nextAction === "ADD_EXPLICIT_PORT_OR_DISPATCH_BOUNDARY"));
});
