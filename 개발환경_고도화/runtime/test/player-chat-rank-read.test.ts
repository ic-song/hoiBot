import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPlayerChatRanking, isPlayerChatRankReadCommand } from "../src/player/player-chat-rank-read-service.js";

const row = (name: string, count: string, id: string, rankEmoji = "") => ({ displayName: name, chatCount: count, playerId: id, rankEmoji });

describe("player chat rank read command", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isPlayerChatRankReadCommand("/채팅순위"), true);
    for (const value of [undefined, "채팅순위", "/채팅순위 ", "/채팅순위 1", "/레벨순위"]) assert.equal(isPlayerChatRankReadCommand(value), false);
  });
  it("preserves the history header and BIGINT-safe chat counts", () => {
    const data = formatPlayerChatRanking([row("채팅왕", "9007199254740993", "1", "⭐")], "2026년 8월 1일");
    assert.equal(data, "🏆 채팅 순위 🏆\n[2026년 8월 1일 이후 채팅 이력 기준]\n🥇. ⭐채팅왕 - 채팅수: 9,007,199,254,740,993");
  });
  it("keeps DB order and the rank-eleven allsee boundary", () => {
    const data = formatPlayerChatRanking(Array.from({ length: 12 }, (_, index) => row(`회원${index + 1}`, String(1200 - index), String(index + 1))), "2026년 8월 1일");
    assert.equal((data.match(/\u200b/g) ?? []).length, 500);
    assert.ok(data.indexOf("10위. 회원10") < data.indexOf("\u200b"));
    assert.ok(data.indexOf("\u200b") < data.indexOf("11위. 회원11"));
    assert.match(data, /12위\. 회원12 - 채팅수: 1,189/);
  });
});
