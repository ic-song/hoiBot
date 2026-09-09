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
  assert.equal(plan.summary.alreadyDirectOrEquivalent, 62);
  assert.equal(plan.summary.residualConsumers, 1_071);
  assert.deepEqual(plan.summary.categoryCounts, {
    B_STRICT_EQUIVALENCE: 0,
    C_DIRECT_EXECUTION: 989,
    D_PREREQUISITE: 82,
  });
  assert.equal(new Set(plan.entries.map((entry: { consumerId: string }) => entry.consumerId)).size, 1_071);
  for (const consumerId of ["sql-repository-818137c4fb22037a", "sql-repository-f6c531148a436a21", "sql-repository-31c4099080d9c9c1", "sql-repository-87ed81931dd7417b", "legacy-94904fa11988ff04", "legacy-827e1dc284cea52c", "legacy-bf7edb9e7cee98cd"]) {
    assert.equal(plan.entries.some((entry: { consumerId: string }) => entry.consumerId === consumerId), false);
  }
});

test("the promoted rocket cohort leaves no strict equivalence residual", () => {
  const reusable = plan.entries.filter((entry: { category: string }) => entry.category === "A_REUSABLE_PROOF_ASSET");
  assert.deepEqual(reusable, []);
  assert.deepEqual(plan.equivalenceCohorts, []);
  assert.equal(plan.entries.some((entry: { category: string }) => entry.category === "B_STRICT_EQUIVALENCE"), false);
});

test("blocked dynamic consumers are not counted as complete", () => {
  const blocked = plan.entries.filter((entry: { category: string }) => entry.category === "D_PREREQUISITE");
  assert.equal(blocked.length, 82);
  assert.ok(blocked.every((entry: { nextAction: string }) => entry.nextAction === "ADD_EXPLICIT_PORT_OR_DISPATCH_BOUNDARY"));
});
