import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { BadgeObjectCatalogReadModel } from "../src/catalog/badge-object-catalog-read-model.js";

const migration = fs.readFileSync(new URL("../migrations/410_badge_object_catalog_link.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../../migration-control/rollback/410_badge_object_catalog_link.sql", import.meta.url), "utf8");
const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/badge-object-catalog-link-v1.json", import.meta.url), "utf8"));
const evidence = JSON.parse(fs.readFileSync(new URL("../../migration-control/evidence/badge-object-catalog-link/slice.json", import.meta.url), "utf8"));

test("freezes only the 204 canonical current badge definitions", () => {
  assert.equal(fixture.definitionVersion, 930000002);
  assert.equal(fixture.canonicalDefinitions, 204);
  assert.equal(fixture.physicalVersionRows, 408);
  assert.equal(fixture.objects, 204);
  assert.match(migration, /definition_row\.definition_version_id = 930000002/);
  assert.match(migration, new RegExp(fixture.sourceHash));
  assert.doesNotMatch(migration, /definition_version_id\s*<>\s*930000002/);
});

test("uses BADGE code series and version identity without display-name merging", () => {
  assert.deepEqual(fixture.identity, ["objectType", "series", "badgeCode", "definitionVersion"]);
  assert.match(migration, /'badge\.', LOWER\(definition_row\.source_code\), '\.', LOWER\(definition_row\.badge_code\)/);
  assert.doesNotMatch(migration, /GROUP BY\s+.*display_name/i);
  assert.equal(new Set(fixture.representatives.map((row: { objectKey: string }) => row.objectKey)).size, 4);
});

test("preserves award and display lifecycle metadata with exact source bindings", () => {
  assert.equal(fixture.awardLifecycle, 77);
  assert.equal(fixture.displayLifecycle, 127);
  assert.equal(fixture.sourceBindings, 204);
  assert.equal(fixture.aliases, 0);
  assert.match(migration, /ordinal <= 77 THEN 'AWARD' ELSE 'DISPLAY'/);
  assert.match(migration, /'RUNTIME_DB',\s*'home_badge_definitions'/);
  assert.doesNotMatch(migration, /object_aliases|alias_value/i);
});

test("read model resolves the complete stable identity and never display name", () => {
  const model = new BadgeObjectCatalogReadModel(fixture.representatives.map((row: Record<string, unknown>) => ({
    badgeCode: row.badgeCode as string,
    series: row.series as string,
    definitionVersion: 930000002 as const,
    lifecycleClass: row.lifecycleClass as "AWARD" | "DISPLAY",
    objectKey: row.objectKey as string,
  })));
  assert.equal(model.find("F01", "achievement", 930000002)?.objectKey, "badge.achievement.f01.v930000002");
  assert.equal(model.find("F01", "gacha", 930000002), null);
  assert.equal(model.find("f01", "achievement", 930000002), null);
});

test("is idempotent reversible and excludes protected badge behavior", () => {
  assert.equal((migration.match(/ON DUPLICATE KEY UPDATE/g) ?? []).length, 2);
  assert.match(rollback, /^START TRANSACTION;/);
  assert.match(rollback, /ASSET-FREEZE-v2\.400-badge-object-link-01/);
  assert.doesNotMatch(rollback, /DELETE\s+FROM\s+home_badge_definitions/i);
  assert.doesNotMatch(migration, /player_home_badges|player_badge_equipment|gacha|cube|ledger|provider|main\.js|admin|web-shell/i);
  assert.equal(fixture.ownershipRowsMutated, 0);
  assert.equal(evidence.scope.gate8, false);
});
