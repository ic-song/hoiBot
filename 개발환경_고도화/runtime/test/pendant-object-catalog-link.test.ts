import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../migrations/399_pendant_object_catalog_link.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../../migration-control/rollback/399_pendant_object_catalog_link.sql", import.meta.url), "utf8");
const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pendant-object-catalog-link-v1.json", import.meta.url), "utf8"));
const evidence = JSON.parse(fs.readFileSync(new URL("../../migration-control/evidence/pendant-object-catalog-link/slice.json", import.meta.url), "utf8"));

test("freezes exactly thirteen typed pendant item definitions", () => {
  assert.equal(fixture.definitions, 13);
  assert.equal(fixture.rows.length, 13);
  assert.equal(new Set(fixture.rows.map((row: { code: string }) => row.code)).size, 13);
  assert.match(migration, /definition_row\.asset_type_code='PENDANT'/);
  assert.match(migration, /JSON_UNQUOTE\(JSON_EXTRACT\(definition_row\.metadata_json,'\$\.objectType'\)\)='pendant'/);
  assert.match(migration, /definition_row\.code<>'ITEM-PENDANT-DRAW-TICKET'/);
});

test("creates thirteen ITEM objects and runtime database source bindings", () => {
  assert.equal(fixture.objects, 13);
  assert.equal(fixture.sourceBindings, 13);
  assert.equal(fixture.aliases, 0);
  assert.match(migration, /'ITEM','RUNTIME_DB','item_definitions',definition_row\.code/);
  assert.equal((migration.match(/ON DUPLICATE KEY UPDATE/g) ?? []).length, 2);
  assert.doesNotMatch(migration, /object_aliases|PENDANT'\s*,\s*definition_row\.display_name/);
});

test("copies every pendant metadata invariant without name-only merging", () => {
  assert.match(migration, /JSON_MERGE_PATCH\(\s*definition_row\.metadata_json/);
  for (const field of ["objectType", "grade", "charm", "explore", "rate", "drawOrder", "gradeOrder", "notice"]) {
    assert.ok(field === "objectType" ? fixture.objectType === "ITEM" : fixture.rows.every((row: Record<string, unknown>) => field in row));
  }
  assert.doesNotMatch(migration, /GROUP BY\s+definition_row\.display_name/i);
});

test("excludes tickets policy ownership projection provider and admin", () => {
  assert.doesNotMatch(migration, /pendant_draw_results|pendant_upgrade|inventory_instances|pendant_equip|owned_pendants|provider|admin/i);
  assert.equal(fixture.ownershipRowsMutated, 0);
  assert.equal(evidence.scope.providerIncluded, false);
  assert.equal(evidence.scope.adminIncluded, false);
  assert.equal(evidence.scope.wbs625AdapterReused, true);
});

test("is transactional idempotent and narrowly reversible", () => {
  assert.match(migration, /^SET NAMES utf8mb4;\s*START TRANSACTION;/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.match(rollback, /^START TRANSACTION;/);
  assert.match(rollback, /ASSET-FREEZE-v2\.400-pendant-object-link-01/);
  assert.doesNotMatch(rollback, /item_definitions|pendant_draw|pendant_upgrade|inventory_instances|pendant_equip|owned_pendants/i);
  assert.match(rollback, /COMMIT;\s*$/);
});
