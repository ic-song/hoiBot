import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPrivilegedPointRanking, isPrivilegedPointRankReadCommand, type PointRankRow } from "./privileged-point-rank-read-service.js";

const row = (playerId: string, displayName: string, rankEmoji: string, balance: string): PointRankRow => ({ playerId, displayName, rankEmoji, balance });

describe("privileged point rank read", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isPrivilegedPointRankReadCommand("/포인트확인"), true);
    assert.equal(isPrivilegedPointRankReadCommand("/포인트확인 1"), false);
    assert.equal(isPrivilegedPointRankReadCommand("/포인트확인 안내"), false);
  });

  it("preserves the legacy header, rank labels, rank emoji and point formatting", () => {
    const text = formatPrivilegedPointRanking([
      row("1", "호이", "🌟", "123456789.000"), row("2", "젤리", "🌱", "500"), row("3", "셋", "🥉", "0")
    ]);
    assert.equal(text, "🏆 포인트 잔액 순위 🏆\n\n🥇. [🌟호이] 🅟123,456,789\n🥈. [🌱젤리] 🅟500\n🥉. [🥉셋] 🅟0\n");
  });

  it("renders an empty canonical roster without inventing a message", () => {
    assert.equal(formatPrivilegedPointRanking([]), "🏆 포인트 잔액 순위 🏆\n\n");
  });
});
