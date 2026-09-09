import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPlayerCumulativeLevelRanking,
  isPlayerCumulativeLevelRankReadCommand
} from "../src/player/player-cumulative-level-rank-read-service.js";

const row = (displayName: string, totalLevel: string, playerId: string, rankEmoji = "") => ({
  displayName,
  totalLevel,
  playerId,
  rankEmoji
});

describe("player cumulative level rank read command", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isPlayerCumulativeLevelRankReadCommand("/누렙순위"), true);
    for (const value of [undefined, "누렙순위", "/누렙순위 ", "/누렙순위 1", "/누렙순위목록"]) {
      assert.equal(isPlayerCumulativeLevelRankReadCommand(value), false);
    }
  });

  it("preserves DB order, rank emoji and BIGINT-safe cumulative levels", () => {
    const data = formatPlayerCumulativeLevelRanking([
      row("첫째", "9007199254740993", "11", "⭐"),
      row("둘째", "777", "12")
    ]);
    assert.ok(data.startsWith("🏆 누적 레벨 순위 🏆\n\n"));
    assert.match(data, /🥇⭐첫째 - LV\.9007199254740993/);
    assert.match(data, /🥈둘째 - LV\.777/);
    assert.ok(data.indexOf("첫째") < data.indexOf("둘째"));
  });

  it("keeps the legacy 500-character allsee boundary after the first ten rows", () => {
    const data = formatPlayerCumulativeLevelRanking(Array.from({ length: 12 }, (_, index) =>
      row(`회원${index + 1}`, String(1200 - index), String(index + 1))
    ));
    assert.equal((data.match(/\u200b/g) ?? []).length, 500);
    assert.ok(data.indexOf("10위 회원10") < data.indexOf("\u200b"));
    assert.ok(data.indexOf("\u200b") < data.indexOf("11위 회원11"));
    assert.match(data, /12위 회원12 - LV\.1189/);
  });
});
