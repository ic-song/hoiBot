import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatWeeklyQuestCountReply, isWeeklyQuestCountCommandCandidate, parseWeeklyQuestCountCommand } from "../src/admin/weekly-quest-count-service.js";
import { isPointEditCommandCandidate } from "../src/admin/iris-admin-command-service.js";

describe("weekly quest count command boundary", () => {
  it("accepts exact reset and a complete comma integer update", () => {
    assert.deepEqual(parseWeeklyQuestCountCommand("/주간횟수초기화"), { kind: "reset" });
    assert.deepEqual(parseWeeklyQuestCountCommand("/주간횟수수정 합성 회원, 7"), { kind: "update", targetDisplayName: "합성 회원", count: 7n });
    for (const message of ["/주간횟수초기화", "/주간횟수수정 합성 회원, 7"]) {
      assert.equal(isWeeklyQuestCountCommandCandidate(message), true);
      assert.equal(isPointEditCommandCandidate(message), true);
    }
    for (const message of ["/주간횟수초기화 안내", "/주간횟수수정 합성 회원, 2abc", "/주간횟수수정 합성 회원 2", "/주간횟수수정, 2"]) {
      assert.equal(isWeeklyQuestCountCommandCandidate(message), false);
    }
  });

  it("keeps update and reset completion projections", () => {
    const update = parseWeeklyQuestCountCommand("/주간횟수수정 합성 회원, 6");
    assert.equal(formatWeeklyQuestCountReply({ command: update, affectedPlayerCount: 1 }), "[합성 회원] 님의 주간횟수가 6회로 수정되었습니다.");
    assert.equal(formatWeeklyQuestCountReply({ command: { kind: "reset" }, affectedPlayerCount: 1234 }), "전체 유저 주간횟수 초기화 완료\n초기화된 유저 수: 1234명");
  });
});
