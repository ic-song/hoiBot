import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPetCharmRanking,
  isPetCharmRankCommand,
  type PetCharmRankRow
} from "../src/pet/pet-charm-rank-read-service.js";

const row = (name: string, experience: bigint, order: bigint): PetCharmRankRow => ({
  playerId: order.toString(),
  petImage: "🐶",
  petTitle: "[용감한]",
  petName: name,
  experience,
  sourceOrder: order
});

describe("pet charm rank read command", () => {
  it("accepts the exact legacy command only", () => {
    assert.equal(isPetCharmRankCommand("/펫매력순위"), true);
    for (const value of ["/펫매력순위 1", "/펫매력순위목록", "펫매력순위"]) {
      assert.equal(isPetCharmRankCommand(value), false);
    }
  });

  it("preserves the DB order and renders image, title, pet name and BIGINT charm", () => {
    const data = formatPetCharmRanking([
      row("먼저", 9007199254740993n, 2n),
      row("다음", 9007199254740992n, 1n)
    ]);
    assert.match(data, /🥇\. 🐶\[용감한\] 먼저 💕 9,007,199,254,740,993/);
    assert.ok(data.indexOf("먼저") < data.indexOf("다음"));
  });

  it("always inserts the 500-character allsee boundary after the first ten rows", () => {
    const data = formatPetCharmRanking(Array.from({ length: 11 }, (_, index) =>
      row(`펫${index + 1}`, BigInt(20 - index), BigInt(index + 1))
    ));
    assert.equal((data.match(/\u200b/g) ?? []).length, 500);
    assert.ok(data.indexOf("펫10") < data.indexOf("\u200b"));
    assert.ok(data.indexOf("\u200b") < data.indexOf("펫11"));
  });
});
