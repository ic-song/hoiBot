import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPlayerCumulativeLikeRanking,
  isPlayerCumulativeLikeRankReadCommand
} from "../src/player/player-cumulative-like-rank-read-service.js";

const row = (displayName: string, totalLikes: string, playerId: string, rankEmoji = "") => ({
  displayName,
  totalLikes,
  playerId,
  rankEmoji
});

describe("player cumulative like rank read command", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isPlayerCumulativeLikeRankReadCommand("/누좋순위"), true);
    for (const value of [undefined, "누좋순위", "/누좋순위 ", "/누좋순위 1", "/누좋순위목록"]) {
      assert.equal(isPlayerCumulativeLikeRankReadCommand(value), false);
    }
  });

  it("preserves DB order, rank emoji and BIGINT-safe cumulative likes", () => {
    const data = formatPlayerCumulativeLikeRanking([
      row("첫째", "9007199254740993", "11", "⭐"),
      row("둘째", "777", "12")
    ]);
    assert.ok(data.startsWith("💓 누적 좋아요 순위 💓\n\n"));
    assert.match(data, /🥇⭐첫째 - 💕:9007199254740993/);
    assert.match(data, /🥈둘째 - 💕:777/);
    assert.ok(data.indexOf("첫째") < data.indexOf("둘째"));
  });

  it("keeps the legacy 500-character allsee boundary after the first ten rows", () => {
    const data = formatPlayerCumulativeLikeRanking(Array.from({ length: 12 }, (_, index) =>
      row(`회원${index + 1}`, String(1200 - index), String(index + 1))
    ));
    assert.equal((data.match(/\u200b/g) ?? []).length, 500);
    assert.ok(data.indexOf("10위 회원10") < data.indexOf("\u200b"));
    assert.ok(data.indexOf("\u200b") < data.indexOf("11위 회원11"));
    assert.match(data, /12위 회원12 - 💕:1189/);
  });
});
