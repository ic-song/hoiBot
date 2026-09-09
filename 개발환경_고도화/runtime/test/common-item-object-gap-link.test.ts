import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../migrations/401_common_item_object_gap_link.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../../migration-control/rollback/401_common_item_object_gap_link.sql", import.meta.url), "utf8");
const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/common-item-object-gap-link-v1.json", import.meta.url), "utf8"));
const evidence = JSON.parse(fs.readFileSync(new URL("../../migration-control/evidence/common-item-object-gap-link/slice.json", import.meta.url), "utf8"));

test("freezes the exact common item gap without name-only matching", () => {
  assert.equal(fixture.membership, 413);
  assert.equal(fixture.commonEligible, 249);
  assert.equal(fixture.existingSemanticValid, 195);
  assert.equal(fixture.gap, 54);
  assert.equal(fixture.codes.length, 54);
  assert.equal(new Set(fixture.codes).size, 54);
  assert.match(migration, /JOIN item_definitions definition_row ON definition_row\.code=gap_row\.definition_code/);
  assert.doesNotMatch(migration, /definition_row\.display_name\s*=|GROUP BY\s+.*display_name/i);
});

test("creates exact ITEM objects aliases and source bindings", () => {
  assert.equal(fixture.objectsBefore, 269);
  assert.equal(fixture.objectsAdded, 54);
  assert.equal(fixture.objectsAfter, 323);
  assert.equal(fixture.aliasesAdded, 54);
  assert.equal(fixture.sourceBindingsAdded, 54);
  assert.match(migration, /'ITEM', 'item_code', gap_row\.definition_code/);
  assert.match(migration, /'RUNTIME_DB', 'item_definitions', gap_row\.definition_code/);
  assert.equal((migration.match(/ON DUPLICATE KEY UPDATE/g) ?? []).length, 4);
  assert.equal(fixture.runtimeDefinitionLinks, 54);
  assert.equal(fixture.definitionsSeeded, 2);
});

test("preserves semantic conflict pendant currency and package boundaries", () => {
  assert.equal(fixture.semanticValidAfter, 262);
  assert.equal(fixture.pendantSemanticValid, 13);
  assert.equal(fixture.conflictOccurrencesPreserved, 61);
  assert.equal(fixture.packageDefinitionsPreserved, 151);
  assert.equal(fixture.currencyDefinitionsPreserved, 2);
  assert.equal(fixture.ownershipRowsMutated, 0);
  assert.doesNotMatch(migration, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:package_item_\w+|inventory_\w+|\w*ledger\w*|owned_\w+|ownership_\w+)/i);
  assert.equal(evidence.scope.providerIncluded, false);
  assert.equal(evidence.scope.adminIncluded, false);
});

test("carries forward immutable definition target ownership and source identity", () => {
  assert.match(migration, /CONCAT\('item_definitions\|', gap_row\.definition_code\)/);
  assert.match(migration, /'ownershipModel', IF\(definition_row\.stackable=1, 'STACK', 'INSTANCE'\)/);
  assert.match(migration, /CONCAT\('RUNTIME_DB\|item_definitions\|', gap_row\.definition_code\)/);
  assert.match(migration, /CONDITIONAL_DIRECT_SELECT_SEED_PREVIOUSLY_OMITTED/);
  assert.match(migration, /'seededByMigration','401_common_item_object_gap_link\.sql'/);
  assert.match(migration, /cbf8ce772ac8b0f00ca3c35b8a85306a443e693efc3971aec9bb38da363ab816/);
});

test("is transactional idempotent and narrowly reversible", () => {
  assert.match(migration, /^SET NAMES utf8mb4;\s*START TRANSACTION;/);
  assert.match(migration, /DROP TEMPORARY TABLE tmp_common_item_object_gap_401;\s*COMMIT;\s*$/);
  assert.match(rollback, /^START TRANSACTION;/);
  assert.match(rollback, /ASSET-FREEZE-v2\.400-common-item-object-gap-01/);
  assert.match(rollback, /DELETE definition_row\s+FROM item_definitions definition_row/);
  assert.match(rollback, /AND NOT EXISTS \(\s*SELECT 1 FROM object_registry/);
  assert.doesNotMatch(rollback, /package_item_|inventory_|ledger|owned_/i);
  assert.match(rollback, /COMMIT;\s*$/);
});
