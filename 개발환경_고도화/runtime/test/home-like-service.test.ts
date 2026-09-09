import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHomeLikeCommandCandidate, normalizeHomeLikeDispatchMessage, parseHomeLikeCommand } from "../src/home/home-like-command.js";
import { formatHomeLikeRank, homeLikeKstDate } from "../src/home/home-like-service.js";

describe("home like command and projection", () => {
  it("separates like, rank and reset without prefix collisions", () => {
    assert.equal(isHomeLikeCommandCandidate("/좋아홈 호이 남"), true);
    assert.equal(isHomeLikeCommandCandidate("/좋아홈순위"), true);
    assert.equal(isHomeLikeCommandCandidate("/좋아홈초기화"), true);
    assert.equal(isHomeLikeCommandCandidate("/좋아홈순위 안내"), false);
    assert.equal(isHomeLikeCommandCandidate("/좋아홈 "), false);
    assert.deepEqual(parseHomeLikeCommand("/좋아홈 호이 남"), { kind: "like", targetName: "호이 남" });
    assert.equal(normalizeHomeLikeDispatchMessage("/좋아홈 호이 남"), "/좋아홈");
  });

  it("uses an Asia/Seoul period key across a UTC day boundary", () => {
    assert.equal(homeLikeKstDate(new Date("2026-08-28T14:59:59Z")), "2026-08-28");
    assert.equal(homeLikeKstDate(new Date("2026-08-28T15:00:00Z")), "2026-08-29");
  });

  it("renders every stable row and inserts allsee before rank eleven", () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({ player_id: BigInt(index + 1), display_name: `회원${index + 1}`, like_count: BigInt(12 - index) }));
    const output = formatHomeLikeRank(rows);
    assert.match(output, /🥇 회원1 - 12 좋아홈/);
    assert.match(output, new RegExp("\\u200b{500}11\\. 회원11 - 2 좋아홈"));
    assert.match(output, /12\. 회원12 - 1 좋아홈/);
    assert.equal(formatHomeLikeRank([]), "등록된 펫홈 정보가 없습니다.");
  });
});
