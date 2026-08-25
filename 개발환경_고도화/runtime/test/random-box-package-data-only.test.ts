import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { INDEPENDENT_PACKAGE_FIXTURES } from "./fixtures/package-parity.js";

const fixture = INDEPENDENT_PACKAGE_FIXTURES.find((entry) => entry.legacyCommand === "/랜덤오픈");
const migration = readFileSync(new URL("../migrations/065_random_box_package_seed.sql", import.meta.url), "utf8");

describe("random box catalog data-only seed", () => {
  it("keeps the six legacy rewards as an exact uniform catalog rule", () => {
    assert.ok(fixture);
    assert.equal(fixture.packageId, "PKG-214");
    assert.equal(fixture.consumeItemId, "ITEM-PACKAGE-214");
    assert.equal(fixture.fixedRewards.length, 0);
    assert.equal(fixture.dynamicRules.length, 1);
    const rule = fixture.dynamicRules[0];
    assert.equal(rule?.kind, "WEIGHTED_ONE");
    if (!rule || rule.kind !== "WEIGHTED_ONE") return;
    assert.equal(rule.failureWeight, 0);
    assert.equal(rule.choices.length, 6);
    assert.deepEqual(rule.choices.map((choice) => choice.name), ["잡템상자☠", "정령상자🥀", "치킨상자🐔", "펫먹이🍼", "영지절대방어권🛡(20%)", "영지기습공격권🔥(10%)"]);
    assert.ok(rule.choices.every((choice) => choice.legacyWeight === 1 / 6 && choice.quantity === 1n));
  });

  it("stores only source metadata for the legacy command", () => {
    assert.match(migration, /'PKG-214','\/랜덤오픈','LEGACY_OPEN','\/패키지사용',0/);
    assert.match(migration, /'sharedLegacyRoute','\/전체오픈'/);
    assert.match(migration, /'RANDOM_BOX','WEIGHTED_ONE','ADD','USER'/);
    assert.doesNotMatch(migration, /INSERT\s+INTO\s+package_command_aliases/i);
    assert.doesNotMatch(migration, /INSERT\s+INTO\s+command_aliases/i);
    assert.doesNotMatch(migration, /INSERT\s+INTO\s+command_registry/i);
  });
});
