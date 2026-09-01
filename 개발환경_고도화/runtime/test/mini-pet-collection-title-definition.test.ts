import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = JSON.parse(readFileSync(new URL("../../../data/miniPetCollectionInfo.json", import.meta.url), "utf8"));
const migration = readFileSync(new URL("../migrations/405_mini_pet_collection_title_definition.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../../migration-control/rollback/405_mini_pet_collection_title_definition.sql", import.meta.url), "utf8");
const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/mini-pet-collection-title-definition-v1.json", import.meta.url), "utf8"));

const rows = Object.entries(source.titles).map(([key, value]) => {
  const title = value as { name: string; price: number };
  return { sourceRow: Number(key), stableCode: `MINI-PET-COLLECTION-TITLE-${key.padStart(3, "0")}`,
    displayName: title.name, priceDigits: String(title.price), displayHash: createHash("sha256").update(title.name).digest("hex") };
});
const canonical = JSON.stringify(rows.map((row) => [row.sourceRow,row.stableCode,row.displayName,row.priceDigits,row.displayHash]));

describe("mini pet collection title definition", () => {
  it("freezes exactly 100 titles and excludes both reward sections", () => {
    assert.equal(rows.length, 100);
    assert.equal(Object.keys(source.gradeReward).length, 8);
    assert.equal(Object.keys(source.stageReward).length, 100);
    assert.deepEqual([fixture.titleRows,fixture.gradeRewardRowsExcluded,fixture.stageRewardRowsExcluded], [100,8,100]);
    assert.doesNotMatch(migration, /INSERT INTO (?:grade|stage)_reward/i);
  });

  it("preserves every source row, stable code and display with exact hash", () => {
    assert.equal(new Set(rows.map((row) => row.sourceRow)).size, 100);
    assert.equal(new Set(rows.map((row) => row.stableCode)).size, 100);
    assert.equal(new Set(rows.map((row) => row.displayName)).size, 100);
    assert.equal(new Set(rows.map((row) => row.displayHash)).size, 100);
    assert.equal(createHash("sha256").update(canonical).digest("hex"), fixture.canonicalSourceHash);
    for (const row of rows) {
      assert.match(migration, new RegExp(`\\{\\"sourceRow\\":${row.sourceRow},\\"displayName\\":\\"${row.displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\"\\}`));
    }
  });

  it("uses the complete catalog identity without display merging", () => {
    assert.match(migration, /'MINI_PET_COLLECTION'/);
    assert.match(migration, /1,'ACTIVE','MINI_PET'/);
    assert.match(migration, /UNIQUE KEY uq_migration405_display/);
    assert.match(migration, /UNIQUE KEY uq_migration405_display_hash/);
    assert.equal(fixture.sameDisplayMerges, 0);
  });

  it("keeps every deferred consumer and ownership table unchanged", () => {
    for (const forbidden of ["player_title_instances","player_pet_title_instances","mini_pet_title_assignments","owned_mini_pets","object_registry"])
      assert.doesNotMatch(migration, new RegExp(`(?:INSERT|UPDATE|DELETE)[^;]*${forbidden}`, "i"));
    assert.doesNotMatch(rollback, /DELETE FROM (?:player_titles|pet_titles|mini_pet_title_assignments|owned_mini_pets)/i);
    assert.deepEqual([fixture.legacyPlayerTitleListChanges,fixture.miniPetTitleAssignmentChanges,
      fixture.ownershipConsumerChanges,fixture.customTitleChanges,fixture.objectLinks], [0,0,0,0,0]);
  });
});
