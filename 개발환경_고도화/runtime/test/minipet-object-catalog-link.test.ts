import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../migrations/397_minipet_object_catalog_link.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../../migration-control/rollback/397_minipet_object_catalog_link.sql", import.meta.url), "utf8");
const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/minipet-object-catalog-link-v1.json", import.meta.url), "utf8"));
const evidence = JSON.parse(fs.readFileSync(new URL("../../migration-control/evidence/minipet-object-catalog-link/slice.json", import.meta.url), "utf8"));

test("mini pet object catalog link freezes the exact source boundary", () => {
  assert.equal(fixture.sourceRows, 1078);
  assert.equal(fixture.definitionTotal, 1106);
  assert.equal(fixture.extraDefinitions, 28);
  assert.match(migration, /FROM mini_pet_definition_source_bindings binding_row/);
  assert.match(migration, /binding_row\.catalog_version='ASSET-FREEZE-v2\.400-a286279b-01'/);
});

test("creates one MINI_PET object for every source identity", () => {
  assert.equal(fixture.objects, 1078);
  assert.match(migration, /CONCAT\('mini_pet\.catalog_',LPAD\(binding_row\.source_index,4,'0'\)\)/);
  assert.match(migration, /'MINI_PET'/);
  assert.doesNotMatch(migration, /GROUP BY\s+definition_row\.display_name/i);
});

test("uses unique compatibility aliases and exact legacy source bindings", () => {
  assert.equal(fixture.aliases, 1078);
  assert.equal(fixture.sourceBindings, 1078);
  assert.match(migration, /'legacy_code',binding_row\.compatibility_code/);
  assert.match(migration, /binding_row\.source_system,binding_row\.source_table,binding_row\.source_key/);
});

test("preserves all composite collisions as separate identities", () => {
  assert.equal(fixture.nameGradeComposite, 1055);
  assert.equal(fixture.collisionGroups, 22);
  assert.equal(fixture.collisionSurplus, 23);
  assert.equal(fixture.sourceRows - fixture.nameGradeComposite, fixture.collisionSurplus);
});

test("keeps draw elite and extra definition boundaries unchanged", () => {
  assert.equal(fixture.drawDefinitions, 1066);
  assert.equal(fixture.eliteDefinitions, 12);
  assert.equal(fixture.drawDefinitions + fixture.eliteDefinitions, fixture.sourceRows);
  assert.doesNotMatch(migration, /INSERT INTO mini_pet_definitions/i);
  assert.doesNotMatch(migration, /UPDATE mini_pet_definitions/i);
});

test("excludes ownership ledger package and legacy runtime consumers", () => {
  assert.doesNotMatch(migration, /owned_mini_pets|ownership|ledger|package_catalog|main\.js/i);
  assert.equal(evidence.scope.providerIncluded, false);
  assert.equal(evidence.scope.ownershipLedgerPackageIncluded, false);
});

test("is transactional idempotent and narrowly reversible", () => {
  assert.match(migration, /^SET NAMES utf8mb4;\s*START TRANSACTION;/);
  assert.equal((migration.match(/ON DUPLICATE KEY UPDATE/g) ?? []).length, 3);
  assert.match(migration, /COMMIT;\s*$/);
  assert.match(rollback, /^START TRANSACTION;/);
  assert.match(rollback, /ASSET-FREEZE-v2\.400-mini-pet-object-link-01/);
  assert.match(rollback, /COMMIT;\s*$/);
});
