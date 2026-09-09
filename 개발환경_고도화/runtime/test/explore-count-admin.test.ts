import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatExploreCountAdminReply, isExploreCountAdminCommandCandidate, parseExploreCountAdminCommand } from "../src/admin/explore-count-admin-service.js";

describe("explore count admin command boundary", () => {
  it("accepts a complete member name and unsigned count", () => {
    assert.deepEqual(parseExploreCountAdminCommand("/탐험횟수수정 합성 회원 7"), { targetDisplayName: "합성 회원", count: 7n });
    assert.equal(isExploreCountAdminCommandCandidate("/탐험횟수수정 합성 회원 0"), true);
  });

  it("rejects suffix text, missing targets, and negative counts", () => {
    for (const message of ["/탐험횟수수정", "/탐험횟수수정 회원", "/탐험횟수수정 회원 -1", "/탐험횟수수정 회원 2 해봐", "/탐험횟수수정 회원 2abc"]) {
      assert.equal(isExploreCountAdminCommandCandidate(message), false);
    }
    assert.throws(() => parseExploreCountAdminCommand("/탐험횟수수정 회원 -1"), /사용법/);
  });

  it("keeps the legacy completion projection", () => {
    assert.equal(
      formatExploreCountAdminReply({ targetDisplayName: "합성 회원", countBefore: 2n, countAfter: 7n }),
      "✅ 탐험횟수 수정 완료\n대상: 합성 회원\n변경: 2 -> 7"
    );
  });
});
