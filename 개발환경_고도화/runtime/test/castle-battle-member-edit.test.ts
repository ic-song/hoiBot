import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCastleBattleMemberEditReply,
  isCastleBattleMemberEditCommandCandidate,
  parseCastleBattleMemberEditCommand
} from "../src/castle/castle-battle-member-edit-service.js";

describe("castle battle member edit command boundary", () => {
  it("parses multi-token targets and command-specific integer values", () => {
    assert.deepEqual(parseCastleBattleMemberEditCommand("/캐슬대전횟수리셋 합성 회원 7"), {
      kind: "attempt", commandCode: "CASTLE_BATTLE_ATTEMPT_SET", targetDisplayName: "합성 회원", value: 7n
    });
    assert.deepEqual(parseCastleBattleMemberEditCommand("/캐슬스코어 합성 회원 -5"), {
      kind: "score", commandCode: "CASTLE_BATTLE_SCORE_SET", targetDisplayName: "합성 회원", value: -5n
    });
  });

  it("rejects incomplete, suffix, negative-attempt, decimal, and overflow inputs", () => {
    for (const message of [
      "/캐슬대전횟수리셋", "/캐슬대전횟수리셋 회원 -1", "/캐슬대전횟수리셋 회원 1.5",
      "/캐슬대전횟수리셋 회원 7 해봐", "/캐슬대전횟수리셋 회원 18446744073709551616",
      "/캐슬스코어 회원 9223372036854775808", "/캐슬스코어 회원 -9223372036854775809"
    ]) assert.equal(isCastleBattleMemberEditCommandCandidate(message), false);
  });

  it("renders the two persisted absolute-value results", () => {
    assert.equal(
      formatCastleBattleMemberEditReply(parseCastleBattleMemberEditCommand("/캐슬대전횟수리셋 합성 회원 7")),
      "[합성 회원] 님의 캐슬대전 횟수를 7회로 변경했습니다."
    );
    assert.equal(
      formatCastleBattleMemberEditReply(parseCastleBattleMemberEditCommand("/캐슬스코어 합성 회원 125")),
      "[합성 회원] 님의 캐슬스코어를 125점으로 변경했습니다."
    );
  });

  it("registers only strict forms as common Iris dispatch candidates", () => {
    assert.equal(isCastleBattleMemberEditCommandCandidate("/캐슬대전횟수리셋 합성 회원 7"), true);
    assert.equal(isCastleBattleMemberEditCommandCandidate("/캐슬스코어 합성 회원 -5"), true);
    assert.equal(isCastleBattleMemberEditCommandCandidate("/캐슬스코어 합성 회원 7 해봐"), false);
  });
});
