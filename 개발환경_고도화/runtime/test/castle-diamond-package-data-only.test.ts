import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { INDEPENDENT_PACKAGE_FIXTURES } from "./fixtures/package-parity.js";

describe("castle diamond package data-only catalog contract", () => {
  it("adds the exact consumer and three fixed rewards as the thirtieth fixture", () => {
    const fixture = INDEPENDENT_PACKAGE_FIXTURES.find((candidate) => candidate.packageId === "PKG-213");
    assert.ok(fixture);
    assert.equal(fixture.legacyCommand, "/다이아오픈");
    assert.equal(fixture.consumeItemId, "ITEM-PACKAGE-213");
    assert.equal(fixture.consumeItemName, "💎다이아 상자(/다이아오픈)");
    assert.equal(fixture.maxOpenCount, 1);
    assert.deepEqual(fixture.fixedRewards.map((reward) => [reward.itemId, reward.quantity]), [
      ["ITEM-RWD-042", 200n],
      ["ITEM-RWD-065", 6n],
      ["ITEM-RWD-026", 2_200n]
    ]);
  });

  it("stores the legacy command as non-executable source data without a handler or alias", () => {
    const migration = readFileSync(new URL("../migrations/064_castle_diamond_package_seed.sql", import.meta.url), "utf8");
    assert.match(migration, /'PKG-213','\/다이아오픈','LEGACY_OPEN','\/패키지사용',0/);
    assert.doesNotMatch(migration, /INSERT INTO command_registry/);
    assert.doesNotMatch(migration, /INSERT INTO (?:package_)?command_aliases/);
    assert.match(migration, /DELETE FROM command_aliases\s+WHERE command_text='\/다이아오픈'/);
  });
});
