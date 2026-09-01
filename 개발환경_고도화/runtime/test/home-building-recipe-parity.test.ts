import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/home-building-recipe-parity-v2438.json", import.meta.url), "utf8"));
const migration = fs.readFileSync(new URL("../migrations/428_home_building_recipe_parity.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../../migration-control/rollback/428_home_building_recipe_parity.sql", import.meta.url), "utf8");

describe("home building recipe parity", () => {
  it("pins the approved source and complete recipe delta", () => {
    assert.equal(fixture.sourceRevision, "5925b83b1dbfb78ef583354604e112b9430003f3");
    assert.equal(fixture.sourceSha256, "726385f7c9b9aed94bcb62c2eb6f9267e32d6a90a4216b50175cdfded878744b");
    assert.deepEqual(fixture.counts, { baselineRows:300, approvedRows:300, baselineDefinitions:299, approvedDefinitions:299, reusedDefinitions:299, changedRecipes:300, requirements:2683, itemTargets:10, newItemTargets:2, duplicateIdentityGroups:1, duplicateIdentityRows:2, duplicateIdentityOccurrences:1, floor190Rows:2, floor190Definitions:2, floor263Rows:2, floor263Definitions:1 });
  });

  it("keeps dense ordered building and requirement occurrences", () => {
    assert.deepEqual(fixture.rows.map((row: { sourceSequence: number }) => row.sourceSequence), Array.from({ length:300 }, (_, index) => index + 1));
    for (const row of fixture.rows) {
      const requirements = fixture.requirements.filter((entry: { sourceSequence: number }) => entry.sourceSequence === row.sourceSequence);
      assert.deepEqual(requirements.map((entry: { requirementSequence: number }) => entry.requirementSequence), Array.from({ length:requirements.length }, (_, index) => index + 1));
    }
  });

  it("reuses exact building identities while preserving floor anomalies", () => {
    assert.equal(new Set(fixture.definitions.map((row: { identityHash: string }) => row.identityHash)).size, 299);
    assert.equal(fixture.rows.filter((row: { floor: number }) => row.floor === 190).length, 2);
    assert.equal(new Set(fixture.rows.filter((row: { floor: number }) => row.floor === 190).map((row: { identityHash: string }) => row.identityHash)).size, 2);
    assert.equal(new Set(fixture.rows.filter((row: { floor: number }) => row.floor === 263).map((row: { identityHash: string }) => row.identityHash)).size, 1);
  });

  it("resolves all ten recipe targets and adds only iron and wood", () => {
    assert.deepEqual(fixture.itemOccurrences.map((row: { displayName: string; occurrenceCount: number }) => [row.displayName,row.occurrenceCount]), [["땅문서📜",300],["돌멩이🪨",300],["펫 강화석⭐",300],["철근⛓️",300],["양념치킨🐔",300],["목재🌳",300],["레이드타격대인장👑(+600👾)",140],["잡템☠️",291],["전설의 돌맹이🗿",251],["펫먹이🍼",201]]);
    assert.deepEqual(fixture.itemOccurrences.filter((row: { isNew: boolean }) => row.isNew).map((row: { code: string }) => row.code), ["home_material_iron","home_material_wood"]);
    assert.match(migration, /BINARY item_row\.display_name=BINARY row_data\.source_item_name/);
  });

  it("uses immutable versioned rows without overwriting baseline progression", () => {
    assert.match(migration, /home_building_recipe_catalog_versions/);
    assert.match(migration, /home_building_recipe_rows/);
    assert.match(migration, /home_building_recipe_requirements/);
    assert.doesNotMatch(migration, /(?:UPDATE|DELETE FROM)\s+home_building_progression/i);
    assert.match(migration, /petSweetHomeInfo\.homeInfo\.v2_438/);
  });

  it("does not mutate ownership, providers, consumers, or operations", () => {
    for (const table of ["inventory_stacks","inventory_ledger","owned_furniture","furniture_inventory_instances","operations","command_audit","outbox_messages","command_registry","command_aliases"]) assert.doesNotMatch(migration, new RegExp(`(?:INSERT|UPDATE|DELETE)\\s+(?:INTO\\s+|FROM\\s+)?${table}\\b`, "i"));
  });

  it("is idempotent and narrowly reversible", () => {
    assert.match(migration, /^SET NAMES utf8mb4;\s*START TRANSACTION;/);
    assert.match(migration, /ON DUPLICATE KEY UPDATE version_code=VALUES\(version_code\)/);
    assert.match(migration, /COMMIT;\s*$/);
    assert.match(rollback, /version_code='ASSET-FREEZE-v2\.438-home-building-recipe-01'/);
    assert.match(rollback, /home_material_iron','home_material_wood/);
    assert.doesNotMatch(rollback, /DELETE FROM (?:inventory_stacks|inventory_ledger|owned_furniture)/i);
  });
});
