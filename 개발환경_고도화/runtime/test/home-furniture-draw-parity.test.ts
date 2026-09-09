import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/home-furniture-draw-parity-v2438.json", import.meta.url), "utf8"));
const migration = fs.readFileSync(new URL("../migrations/426_home_furniture_draw_parity.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../../migration-control/rollback/426_home_furniture_draw_parity.sql", import.meta.url), "utf8");

describe("home furniture draw parity", () => {
  it("pins the approved source and complete delta", () => {
    assert.equal(fixture.sourceRevision, "5925b83b1dbfb78ef583354604e112b9430003f3");
    assert.equal(fixture.sourceSha256, "726385f7c9b9aed94bcb62c2eb6f9267e32d6a90a4216b50175cdfded878744b");
    assert.equal(fixture.sourceGitObjectSha256, "9aa01517393750942992547223445ad0c77f0351d4a6700c05c36bd10cc7e288");
    assert.deepEqual(fixture.counts, { baselineRows: 1551, approvedRows: 2447, sourceRowDelta: 896, baselineDefinitions: 1533, approvedDefinitions: 2422, reusedDefinitions: 1444, newDefinitions: 978, duplicateGroups: 9, duplicateRows: 34, duplicateWeightOccurrences: 25, grades: 7, logicalNames: 538, currentSourceBindings: 2447 });
  });

  it("preserves all seven first-row grade rates and entry counts", () => {
    assert.deepEqual(fixture.gradeBands.map((row: Record<string, unknown>) => [row.gradeDisplayName,row.rateText,row.weightScaled,row.entryCount]), [
      ["리브","0.99959",9995900,617],["쁘띠","0.0003",3000,400],["부띠끄","0.00005",500,400],["시그니엘","0.00003",300,551],["그랑 루미에르","0.00002",200,298],["로열 루미에르","0.00001",100,41],["아르카나 루미에르","0.0000065",65,140]
    ]);
    assert.equal(fixture.rateScale, 10000000);
  });

  it("keeps dense source and within-grade occurrence order", () => {
    assert.deepEqual(fixture.occurrences.map((row: { sourceSequence: number }) => row.sourceSequence), Array.from({ length: 2447 }, (_, index) => index + 1));
    for (const band of fixture.gradeBands) {
      const rows = fixture.occurrences.filter((row: { gradeOrdinal: number }) => row.gradeOrdinal === band.gradeOrdinal);
      assert.deepEqual(rows.map((row: { withinGradeSequence: number }) => row.withinGradeSequence), Array.from({ length: band.entryCount }, (_, index) => index + 1));
    }
  });

  it("reuses only exact signatures and keeps duplicate draw weight rows", () => {
    assert.equal(fixture.definitions.filter((row: { baselineReused: boolean }) => row.baselineReused).length, 1444);
    assert.equal(fixture.definitions.filter((row: { baselineReused: boolean }) => !row.baselineReused).length, 978);
    assert.equal(new Set(fixture.definitions.map((row: { signatureHash: string }) => row.signatureHash)).size, 2422);
    assert.equal(fixture.occurrences.length - new Set(fixture.occurrences.map((row: { signatureHash: string }) => row.signatureHash)).size, 25);
  });

  it("links definitions and objects without name-only matching", () => {
    assert.match(migration, /definition_row\.code=row_data\.canonical_code AND BINARY definition_row\.display_name=BINARY row_data\.source_display_name AND definition_row\.charm_value=row_data\.charm_value/);
    assert.match(migration, /signatureHash/);
    assert.doesNotMatch(migration, /JOIN furniture_definitions definition_row ON definition_row\.display_name=row_data\.source_display_name/);
    assert.match(migration, /petSweetHomeInfo\.furnitureDraw\.v2_438/);
  });

  it("does not mutate ownership, operations, providers, or consumers", () => {
    for (const table of ["owned_furniture","furniture_inventory_instances","furniture_inventory_ledger","home_furniture_draw_operations","home_furniture_draw_results","inventory_stacks","inventory_ledger","operations","command_registry","command_aliases"]) {
      assert.doesNotMatch(migration, new RegExp(`(?:INSERT|UPDATE|DELETE)\\s+(?:INTO\\s+|FROM\\s+)?${table}\\b`, "i"));
    }
    assert.doesNotMatch(migration, /HOME_FURNITURE_DRAW'.*rollout_state/i);
  });

  it("is idempotent and narrowly reversible to the baseline catalog", () => {
    assert.match(migration, /^SET NAMES utf8mb4;\s*START TRANSACTION;/);
    assert.match(migration, /ON DUPLICATE KEY UPDATE version_code=VALUES\(version_code\)/);
    assert.match(migration, /COMMIT;\s*$/);
    assert.match(rollback, /source_table='petSweetHomeInfo\.furnitureDraw\.v2_438'/);
    assert.match(rollback, /source_sha256='73c93af3f0a5d52e4539047a21ce0d08f33603275ca542974eb11f47f93b2195'/);
    assert.doesNotMatch(rollback, /DELETE FROM (?:owned_furniture|furniture_inventory_instances|inventory_)/i);
  });
});
