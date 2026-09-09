import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../migrations/440_asset_package_data_migration_ready_gap_closure.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../../migration-control/rollback/440_asset_package_data_migration_ready_gap_closure.sql", import.meta.url), "utf8");
const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/package-data-migration-ready-gap-closure-v1.json", import.meta.url), "utf8"));

test("package data-migration-ready closure preserves the frozen catalog", () => {
  assert.deepEqual(fixture.frozen, {packages:107,occurrences:557,stackGaps:46,packageGaps:44});
  assert.match(migration, /package_count=107 AND occurrence_count=557/);
  assert.match(migration, /publication_status\).*'SHADOW'/s);
});

test("all 80 residual occurrences receive source-backed object bindings", () => {
  assert.equal(fixture.closure.residualStackOccurrenceBindings, 36);
  assert.equal(fixture.closure.packageOccurrenceBindings, 44);
  assert.equal(fixture.stackIdentities.reduce((sum:number,row:[string,string,number])=>sum+row[2],0),36);
  assert.match(migration, /stack_overlay_count=46 AND package_overlay_count=44/);
  assert.match(migration, /residual_stack_gap_count=0 AND residual_package_gap_count=0 AND conflict_count=0/);
});

test("package identity uses source package ids rather than display-name guessing", () => {
  assert.equal(fixture.rules.packageIdentity,"exact target_source_package_id relationship");
  assert.equal(fixture.rules.nameOnlyMerge,false);
  assert.match(migration, /target_definition\.source_package_id/);
  assert.match(migration, /package\.source\.'/);
});

test("the closure adds no schema, provider, consumer, or operational publication", () => {
  assert.equal(fixture.rules.newProvider,false);
  assert.equal(fixture.rules.newSchema,false);
  assert.equal(fixture.rules.consumerChanged,false);
  assert.doesNotMatch(migration,/CREATE TABLE (?!tmp_)/i);
  assert.doesNotMatch(migration,/PUBLISHED|feature\/prod|main\.js|UPDATE package_catalog/i);
});

test("rollback removes only version-owned catalog and bindings", () => {
  assert.match(rollback,/package-data-migration-ready-gap-closure-01#%/);
  assert.match(rollback,/sourceCatalogVersion/);
  assert.match(rollback,/440_asset_package_data_migration_ready_gap_closure/);
});
