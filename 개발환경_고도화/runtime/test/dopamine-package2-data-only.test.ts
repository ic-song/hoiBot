import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { INDEPENDENT_PACKAGE_FIXTURES } from "./fixtures/package-parity.js";

describe("dopamine package 2 data-only catalog contract", () => {
  it("keeps the exact package and five fixed rewards in the shared catalog fixture", () => {
    const fixture = INDEPENDENT_PACKAGE_FIXTURES.find((candidate) => candidate.packageId === "PKG-098");
    assert.ok(fixture);
    assert.equal(fixture.legacyCommand, "/도파민오픈2");
    assert.equal(fixture.consumeItemId, "ITEM-PACKAGE-098");
    assert.deepEqual(fixture.fixedRewards.map((reward) => [reward.itemId, reward.quantity]), [
      ["ITEM-PACKAGE-105", 4_000n],
      ["ITEM-RWD-001", 7_000n],
      ["ITEM-RWD-014", 200n],
      ["ITEM-RWD-015", 1n],
      ["ITEM-RWD-016", 50n]
    ]);
  });

  it("stores legacy commands as non-executable source data and uses only shared routes", () => {
    const migration = readFileSync(new URL("../migrations/061_package_source_command_seed.sql", import.meta.url), "utf8");
    assert.match(migration, /'\/도파민오픈2','LEGACY_OPEN','\/패키지사용',0/);
    assert.match(migration, /'\/도파민민','LEGACY_ADMIN_GRANT','\/패키지지급',0/);
    assert.doesNotMatch(migration, /INSERT INTO command_registry/);
    assert.doesNotMatch(migration, /INSERT INTO (?:package_)?command_aliases/);
  });
});
