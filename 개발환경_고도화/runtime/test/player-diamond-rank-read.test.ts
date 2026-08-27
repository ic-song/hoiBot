import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPlayerDiamondRanking, isPlayerDiamondRankReadCommand } from "../src/player/player-diamond-rank-read-service.js";

const row = (displayName: string, grantedDiamond: string, playerId: string, rankEmoji = "") => ({ displayName, grantedDiamond, playerId, rankEmoji });

describe("player diamond rank read command", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isPlayerDiamondRankReadCommand("/다이아순위"), true);
    for (const value of [undefined, "다이아순위", "/다이아순위 ", "/다이아순위 1", "/다이아순위목록"]) assert.equal(isPlayerDiamondRankReadCommand(value), false);
  });

  it("preserves the empty legacy projection", () => {
    assert.equal(formatPlayerDiamondRanking([]), "💎 다이아 순위 💎\n※ 다이아💎 누적기록\n\n아직 다이아💎 기록이 없습니다.");
  });

  it("preserves DB order, comma formatting and the rank-eleven allsee boundary", () => {
    const data = formatPlayerDiamondRanking(Array.from({ length: 12 }, (_, index) => row(`회원${index + 1}`, String(12000 - index * 1000), String(index + 1), index === 0 ? "⭐" : "")));
    assert.match(data, /🥇\. ⭐회원1 - 💎: 12,000/);
    assert.equal((data.match(/\u200b/g) ?? []).length, 500);
    assert.ok(data.indexOf("10위. 회원10") < data.indexOf("\u200b"));
    assert.ok(data.indexOf("\u200b") < data.indexOf("11위. 회원11"));
    assert.match(data, /12위\. 회원12 - 💎: 1,000/);
  });
});
