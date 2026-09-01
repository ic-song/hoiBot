import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { OBJECT_TYPES } from "../src/catalog/object-catalog.js";

const migration = fs.readFileSync(new URL("../migrations/409_object_catalog_badge_type_extension.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../../migration-control/rollback/409_object_catalog_badge_type_extension.sql", import.meta.url), "utf8");
const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/object-catalog-badge-type-v1.json", import.meta.url), "utf8"));
const evidence = JSON.parse(fs.readFileSync(new URL("../../migration-control/evidence/object-catalog-badge-type-extension/slice.json", import.meta.url), "utf8"));

test("adds BADGE exactly once while preserving all ten existing runtime types", () => {
  assert.equal(OBJECT_TYPES.length, 11);
  assert.equal(OBJECT_TYPES.filter((type) => type === "BADGE").length, 1);
  assert.deepEqual(OBJECT_TYPES.slice(0, 10), fixture.existingTypes);
  assert.equal(new Set(OBJECT_TYPES).size, 11);
});

test("migration409 replaces only the object registry type constraint", () => {
  assert.match(migration, /^ALTER TABLE object_registry/);
  assert.match(migration, /DROP CONSTRAINT chk_object_registry_type/);
  assert.match(migration, /ADD CONSTRAINT chk_object_registry_type/);
  for (const type of [...fixture.existingTypes, "BADGE"]) {
    assert.match(migration, new RegExp(`'${type}'`));
  }
  assert.equal((migration.match(/'BADGE'/g) ?? []).length, 1);
});

test("rollback restores the exact ten-type constraint", () => {
  for (const type of fixture.existingTypes) assert.match(rollback, new RegExp(`'${type}'`));
  assert.doesNotMatch(rollback, /'BADGE'/);
  assert.match(rollback, /^ALTER TABLE object_registry/);
});

test("keeps badge definitions objects ownership providers consumers and UI unchanged", () => {
  assert.doesNotMatch(migration, /INSERT|UPDATE|DELETE|badge_definitions|player_badges|owned_badges|provider|main\.js|web-shell/i);
  assert.equal(fixture.badgeObjectsCreated, 0);
  assert.equal(fixture.badgeDefinitionsChanged, 0);
  assert.equal(fixture.ownershipRowsMutated, 0);
  assert.equal(fixture.providerChanged, false);
  assert.equal(fixture.runtimeConsumerChanged, false);
  assert.equal(evidence.scope.badgeObjectsIncluded, false);
  assert.equal(evidence.scope.badgeDefinitionsIncluded, false);
  assert.equal(evidence.scope.ownershipIncluded, false);
  assert.equal(evidence.scope.providerIncluded, false);
  assert.equal(evidence.scope.runtimeConsumerIncluded, false);
  assert.equal(evidence.scope.gate8, false);
});
