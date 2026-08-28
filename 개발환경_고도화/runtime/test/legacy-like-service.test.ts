import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLegacyLikeCommandCandidate, normalizeLegacyLikeDispatchMessage, parseLegacyLikeCommand } from "../src/social/legacy-like-command.js";
import { formatLegacyLikeRank, legacyLikeKstDate } from "../src/social/legacy-like-service.js";

describe("legacy social like command", () => {
  it("preserves broad legacy guards without stealing adjacent commands", () => {
    for (const value of ["/좋아요 대상", "/좋아요사용횟수", "/좋아요사용횟수abc", "/좋아요순위", "/좋아리셋", "/r"]) assert.equal(isLegacyLikeCommandCandidate(value), true);
    for (const value of [undefined, "/좋아요", "/좋아요순위 1", "/좋아홈 대상", "/r 1"]) assert.equal(isLegacyLikeCommandCandidate(value), false);
    assert.deepEqual(parseLegacyLikeCommand("/좋아요 대상 추가"), { kind: "like", targetName: "대상 추가" });
    assert.equal(normalizeLegacyLikeDispatchMessage("/좋아요 대상"), "/좋아요");
    assert.equal(normalizeLegacyLikeDispatchMessage("/좋아요사용횟수abc"), "/좋아요사용횟수");
  });

  it("formats stable BIGINT rankings and the allsee boundary", () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({ player_id: BigInt(index + 1), display_name: `회원${index + 1}`, like_count: 9007199254740993n - BigInt(index) }));
    const output = formatLegacyLikeRank(rows);
    assert.match(output, /🥇회원1 - 💕:9007199254740993/);
    assert.equal((output.match(/\u200b/g) ?? []).length, 500);
    assert.ok(output.indexOf("10위 회원10") < output.indexOf("\u200b"));
    assert.ok(output.indexOf("\u200b") < output.indexOf("11위 회원11"));
  });

  it("pins the daily limit to the KST calendar date", () => {
    assert.equal(legacyLikeKstDate(new Date("2026-08-28T14:59:59.000Z")), "2026-08-28");
    assert.equal(legacyLikeKstDate(new Date("2026-08-28T15:00:00.000Z")), "2026-08-29");
  });
});
