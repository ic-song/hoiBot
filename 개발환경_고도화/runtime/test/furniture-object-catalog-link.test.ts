import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../migrations/398_furniture_object_catalog_link.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../../migration-control/rollback/398_furniture_object_catalog_link.sql", import.meta.url), "utf8");
const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/furniture-object-catalog-link-v1.json", import.meta.url), "utf8"));
const evidence = JSON.parse(fs.readFileSync(new URL("../../migration-control/evidence/furniture-object-catalog-link/slice.json", import.meta.url), "utf8"));

test("freezes 1551 draw rows into 1533 immutable furniture identities", () => {
  assert.equal(fixture.sourceRows, 1551);
  assert.equal(fixture.physicalDefinitions, 1551);
  assert.equal(fixture.canonicalDefinitions, 1533);
  assert.match(migration, /PARTITION BY BINARY definition_row\.display_name,definition_row\.charm_value,entry_row\.grade_ordinal/);
  assert.match(migration, /source_sha256='73c93af3f0a5d52e4539047a21ce0d08f33603275ca542974eb11f47f93b2195'/);
  assert.doesNotMatch(migration, /GROUP BY\s+definition_row\.display_name/i);
});

test("creates exact FURNITURE object alias and source binding totals", () => {
  assert.equal(fixture.objects, 1533);
  assert.equal(fixture.aliases, 1551);
  assert.equal(fixture.sourceBindings, 1551);
  assert.match(migration, /'FURNITURE','legacy_code',crosswalk_row\.source_code/);
  assert.match(migration, /'LEGACY_JSON','petSweetHomeInfo\.furnitureDraw'/);
  assert.equal((migration.match(/ON DUPLICATE KEY UPDATE/g) ?? []).length, 3);
});

test("preserves ordinary and duplicate occurrence weights", () => {
  assert.equal(fixture.ordinarySourceRows, 1531);
  assert.equal(fixture.ordinaryObjects, 1531);
  assert.equal(fixture.duplicateSourceRows, 20);
  assert.equal(fixture.duplicateObjects, 2);
  assert.equal(fixture.duplicateGroups, 2);
  assert.equal(fixture.duplicateOccurrences, 18);
  assert.deepEqual(fixture.gradeRows, [600, 231, 181, 291, 207, 41]);
  assert.deepEqual(fixture.gradeCanonicalDefinitions, [600, 231, 181, 291, 207, 23]);
});

test("does not mutate definitions draw ownership ledger placement market or consumers", () => {
  assert.doesNotMatch(migration, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?furniture_definitions/i);
  assert.doesNotMatch(migration, /furniture_inventory_instances|furniture_inventory_ledger|owned_furniture|furniture_placements|market_/i);
  assert.equal(fixture.ownershipRowsMutated, 0);
  assert.equal(evidence.scope.providerIncluded, false);
  assert.equal(evidence.scope.adminIncluded, false);
});

test("is transactional idempotent and narrowly reversible", () => {
  assert.match(migration, /^SET NAMES utf8mb4;\s*START TRANSACTION;/);
  assert.match(migration, /DROP TEMPORARY TABLE tmp_furniture_object_crosswalk_398;\s*COMMIT;\s*$/);
  assert.match(rollback, /^START TRANSACTION;/);
  assert.match(rollback, /ASSET-FREEZE-v2\.400-furniture-object-link-01/);
  assert.doesNotMatch(rollback, /furniture_definitions|home_furniture_draw_entries|furniture_inventory|owned_furniture|furniture_placements|market_/i);
  assert.match(rollback, /COMMIT;\s*$/);
});
