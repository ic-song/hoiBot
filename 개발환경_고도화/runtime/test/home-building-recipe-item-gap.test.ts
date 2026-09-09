import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { describe, it } from "node:test";

interface RecipeItemRow {
  legacyName: string;
  definitionCode: string;
  objectKey: string;
  decision: "REUSE_ACTIVATE" | "REUSE_ACTIVE" | "CREATE";
  ownershipModel: "STACK";
  sellable: false;
  homeRecipe: { occurrenceCount: number; minCount: number; maxCount: number; uniqueCounts: number[] };
  otherConsumers: {
    trialTowerRewardRows: number;
    castleBattleRewardRows: number;
    itemListNonItems: boolean;
    itemListUntradable: boolean;
  };
  sourceBindings: Array<{ system: "LEGACY_JSON" | "RUNTIME_DB"; table: string; key: string }>;
  consumerCorrectionDependency?: string;
}

const rows = JSON.parse(fs.readFileSync(
  new URL("../../migration-control/fixtures/synthetic-relational/home-building-recipe-item-crosswalk-v1.json", import.meta.url),
  "utf8"
)) as RecipeItemRow[];
const migration = fs.readFileSync(new URL("../migrations/394_home_building_recipe_item_gap.sql", import.meta.url), "utf8");
const sha256 = (value: string): string => crypto.createHash("sha256").update(value, "utf8").digest("hex");

describe("home building recipe item canonical gap", () => {
  it("freezes four exact identities without name-based merging", () => {
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map((row) => row.definitionCode), [
      "ITEM-RWD-041", "ITEM-RING-UPGRADE-STONE", "castle_coin", "ITEM-RWD-052"
    ]);
    assert.equal(new Set(rows.map((row) => row.definitionCode)).size, 4);
    assert.equal(new Set(rows.map((row) => row.objectKey)).size, 4);
    assert.equal(rows.filter((row) => row.decision.startsWith("REUSE")).length, 3);
    assert.equal(rows.filter((row) => row.decision === "CREATE").length, 1);
    assert.equal(
      sha256(rows.map((row) => `${row.legacyName}\t${row.definitionCode}\t${row.objectKey}\t${row.decision}`).join("\n")),
      "cf8ff7d80c11f3ad7dae69cabd7fb917c79b3cd58429f388a8c6f8953662a444"
    );
  });

  it("preserves all 1,151 home recipe references and exact count ranges", () => {
    assert.deepEqual(rows.map((row) => row.homeRecipe.occurrenceCount), [300, 300, 300, 251]);
    assert.equal(rows.reduce((sum, row) => sum + row.homeRecipe.occurrenceCount, 0), 1151);
    assert.deepEqual(rows.map((row) => [row.homeRecipe.minCount, row.homeRecipe.maxCount]), [
      [1000, 300000], [50, 100], [10, 100], [3, 8]
    ]);
    assert.equal(rows[0]!.homeRecipe.uniqueCounts.length, 23);
    assert.deepEqual(rows[1]!.homeRecipe.uniqueCounts, [50, 60, 70, 100]);
  });

  it("binds canonical definitions to every verified JSON source", () => {
    assert.equal(rows.reduce((sum, row) => sum + row.sourceBindings.length, 0), 18);
    for (const row of rows) {
      assert.equal(row.ownershipModel, "STACK");
      assert.equal(row.sellable, false);
      assert.ok(row.sourceBindings.some((binding) => binding.system === "RUNTIME_DB" && binding.table === "item_definitions" && binding.key === row.definitionCode));
      assert.ok(row.sourceBindings.some((binding) => binding.system === "LEGACY_JSON" && binding.table === "petSweetHomeInfo.homeInfo.required" && binding.key === row.legacyName));
    }
    assert.deepEqual(rows.map((row) => row.otherConsumers.trialTowerRewardRows), [88, 1, 1, 1]);
    assert.deepEqual(rows.map((row) => row.otherConsumers.castleBattleRewardRows), [0, 0, 24, 0]);
  });

  it("records the legendary-stone consumer correction as a dependency only", () => {
    assert.equal(rows[3]!.consumerCorrectionDependency, "inventory.open_all:legendary_stone->ITEM-RWD-052");
    assert.doesNotMatch(migration, /INSERT INTO item_definitions[^;]*['\"]legendary_stone['\"]/is);
  });

  it("keeps migration 394 idempotent and inside the approved catalog scope", () => {
    assert.match(migration, /INSERT INTO item_sale_policies/);
    assert.match(migration, /ON DUPLICATE KEY UPDATE sellable=FALSE/);
    assert.equal((migration.match(/'legacy_name'/g) ?? []).length, 4);
    assert.equal((migration.match(/'RUNTIME_DB'/g) ?? []).length, 4);
    assert.equal((migration.match(/'LEGACY_JSON'/g) ?? []).length, 14);
    assert.doesNotMatch(migration, /ITEM-RWD-042/);
    assert.doesNotMatch(migration, /\b(?:DELETE|TRUNCATE)\b/i);
    assert.doesNotMatch(migration, /\binventory_(?:stacks|instances|ledger)\b/i);
    assert.doesNotMatch(migration, /\bpackage_(?:item|catalog|contents|reward)/i);
    assert.doesNotMatch(migration, /\bplayer_homes\b/i);
  });
});
