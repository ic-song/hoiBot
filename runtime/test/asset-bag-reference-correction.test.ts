import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { isLegacyDynamicBagProjection } from "../src/data-migration/asset-reference-validation.js";

const validator = new URL("../src/data-migration/asset-reference-validation.ts", import.meta.url);

describe("legacy bag item reference correction", () => {
  it("separates the exact pet-intimacy state projection from item definitions", () => {
    assert.equal(isLegacyDynamicBagProjection("펫 친밀도🐾[Lv.1](0/1000)+0💕"), true);
    assert.equal(isLegacyDynamicBagProjection("펫 친밀도🐾 [Lv.250](999/1000)+12345💕"), true);
  });

  it("fails closed for nearby inventory names", () => {
    assert.equal(isLegacyDynamicBagProjection("펫 친밀도🐾"), false);
    assert.equal(isLegacyDynamicBagProjection("펫 친밀도🐾[Lv.1](0/1000)+0💕 suffix"), false);
    assert.equal(isLegacyDynamicBagProjection("일반 아이템[Lv.1](0/1000)+0💕"), false);
  });

  it("keeps the correction read-only and narrowly scoped", async () => {
    const source = await readFile(validator, "utf8");
    assert.match(source, /isLegacyDynamicBagProjection\(itemName\)/);
    assert.doesNotMatch(source, /INSERT INTO|UPDATE item_definitions|DELETE FROM item_definitions/);
  });
});
