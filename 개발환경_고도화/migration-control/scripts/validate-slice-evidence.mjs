import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const input = process.argv[2];
assert.ok(input, "usage: node validate-slice-evidence.mjs <slice.json>");
const path = resolve(input);
const evidence = JSON.parse(await readFile(path, "utf8"));
assert.equal(evidence.schemaVersion, 1);
for (const key of ["sliceId", "status", "execution", "commands", "legacyData", "database", "trialMigration", "logicPort", "parity", "cutover", "risks"]) {
  assert.ok(evidence[key] !== undefined, `missing evidence section: ${key}`);
}
assert.ok(typeof evidence.execution.executionId === "string" && evidence.execution.executionId.length > 0);
assert.ok(Number.isInteger(evidence.execution.claimRow) && evidence.execution.claimRow > 1);
assert.ok(Array.isArray(evidence.commands.names) && evidence.commands.names.length > 0);
assert.ok(Array.isArray(evidence.database.tables) && evidence.database.tables.length > 0);
assert.ok(Array.isArray(evidence.logicPort.tests) && evidence.logicPort.tests.length > 0);
assert.ok(Array.isArray(evidence.risks));
assert.ok(["passed", "passed_with_approval_required_safe_difference"].includes(evidence.parity.result));
if (evidence.cutover.gate8Complete === true) {
  assert.ok(evidence.cutover.productionEvidence?.length > 0, "Gate 8 requires explicit production evidence.");
}
process.stdout.write(`valid slice evidence: ${evidence.sliceId}\n`);
