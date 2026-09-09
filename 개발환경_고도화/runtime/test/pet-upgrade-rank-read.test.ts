import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPetUpgradeRanking,
  isPetUpgradeRankCommand,
  type PetUpgradeRankRow
} from "../src/pet/pet-upgrade-rank-read-service.js";

const row = (name: string, level: bigint, order: bigint): PetUpgradeRankRow => ({
  playerId: order.toString(),
  displayName: name,
  rankEmoji: "🌱",
  enhancementLevel: level,
  sourceOrder: order
});

describe("pet upgrade rank read command", () => {
  it("accepts the exact legacy command only", () => {
    assert.equal(isPetUpgradeRankCommand("/펫강순위"), true);
    for (const value of ["/펫강순위 1", "/펫강순위목록", "펫강순위"]) {
      assert.equal(isPetUpgradeRankCommand(value), false);
    }
  });

  it("preserves the DB order and renders enhancement BIGINT values without precision loss", () => {
    const data = formatPetUpgradeRanking([
      row("먼저", 9007199254740993n, 2n),
      row("다음", 9007199254740992n, 1n)
    ]);
    assert.match(data, /🥇\. 🌱먼저 - 강화 레벨: 9007199254740993⭐/);
    assert.ok(data.indexOf("먼저") < data.indexOf("다음"));
  });

  it("always inserts the 500-character allsee boundary after the first ten rows", () => {
    const data = formatPetUpgradeRanking(Array.from({ length: 11 }, (_, index) =>
      row(`유저${index + 1}`, BigInt(20 - index), BigInt(index + 1))
    ));
    assert.equal((data.match(/\u200b/g) ?? []).length, 500);
    assert.ok(data.indexOf("유저10") < data.indexOf("\u200b"));
    assert.ok(data.indexOf("\u200b") < data.indexOf("유저11"));
  });
});
