import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { INDEPENDENT_PACKAGE_FIXTURES } from "./fixtures/package-parity.js";

const fixture = INDEPENDENT_PACKAGE_FIXTURES.find((entry) => entry.legacyCommand === "/상자오픈");
const migration = readFileSync(new URL("../migrations/066_pet_food_box_package_seed.sql", import.meta.url), "utf8");

describe("pet food box catalog data-only seed", () => {
  it("keeps the exact four legacy quantities and probabilities", () => {
    assert.ok(fixture);
    assert.equal(fixture.packageId, "PKG-215");
    assert.equal(fixture.consumeItemId, "ITEM-RWD-PET-FOOD-BOX");
    const rule = fixture.dynamicRules[0];
    assert.equal(rule?.kind, "WEIGHTED_ONE");
    if (!rule || rule.kind !== "WEIGHTED_ONE") return;
    assert.deepEqual(rule.choices.map((choice) => choice.quantity), [50n, 100n, 250n, 500n]);
    assert.deepEqual(rule.choices.map((choice) => choice.legacyWeight), [0.9815, 0.015, 0.003, 0.0005]);
    assert.equal(rule.choices.reduce((sum, choice) => sum + choice.legacyWeight, 0), 1);
  });

  it("separates the conflicting castle command from package execution", () => {
    assert.match(migration, /'PKG-215','\/상자오픈','LEGACY_OPEN','\/패키지사용',0/);
    assert.match(migration, /'conflictingLegacyCommand','\/캐슬오픈'/);
    assert.match(migration, /'conflictPolicy','EXCLUDED_FROM_PACKAGE_ALIAS'/);
    assert.doesNotMatch(migration, /INSERT\s+INTO\s+package_command_aliases/i);
    assert.doesNotMatch(migration, /INSERT\s+INTO\s+command_aliases/i);
    assert.doesNotMatch(migration, /INSERT\s+INTO\s+command_registry/i);
  });
});
