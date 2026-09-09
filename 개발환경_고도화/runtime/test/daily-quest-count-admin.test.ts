import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatDailyQuestCountAdminReply,
  isDailyQuestCountAdminCommandCandidate,
  parseDailyQuestCountAdminCommand
} from "../src/admin/daily-quest-count-admin-service.js";

describe("daily quest count admin command boundary", () => {
  it("parses four required counters and an optional reward counter", () => {
    assert.deepEqual(parseDailyQuestCountAdminCommand("/일퀘횟수수정 합성 회원 1 2 3 4"), {
      targetDisplayName: "합성 회원", towerAttempts: 1n, castleBattleAttempts: 2n, miniBattleAttempts: 3n, exploreAttempts: 4n, dailyRewardCount: undefined
    });
    assert.deepEqual(parseDailyQuestCountAdminCommand("/일퀘횟수수정 합성 회원 15 15 15 10 7"), {
      targetDisplayName: "합성 회원", towerAttempts: 15n, castleBattleAttempts: 15n, miniBattleAttempts: 15n, exploreAttempts: 10n, dailyRewardCount: 7n
    });
  });

  it("rejects incomplete, out-of-range, negative, and suffix-guide inputs", () => {
    for (const message of [
      "/일퀘횟수수정", "/일퀘횟수수정 회원 1 2 3", "/일퀘횟수수정 회원 16 2 3 4",
      "/일퀘횟수수정 회원 1 16 3 4", "/일퀘횟수수정 회원 1 2 16 4", "/일퀘횟수수정 회원 1 2 3 11",
      "/일퀘횟수수정 회원 1 2 3 -1", "/일퀘횟수수정 회원 1 2 3 4 해봐"
    ]) assert.equal(isDailyQuestCountAdminCommandCandidate(message), false);
  });

  it("keeps the legacy completion projection", () => {
    const command = parseDailyQuestCountAdminCommand("/일퀘횟수수정 합성 회원 3 2 4 5 6");
    assert.equal(
      formatDailyQuestCountAdminReply(command),
      "✅ 일퀘횟수 수정 완료\n대상: [합성 회원]\n시련탑😈: 3/15\n캐대전🏆: 2/15 (무료대전 사용: 1/1)\n미대전🐹: 4/15\n펫탐험⛰️: 5/10\n일일보상횟수: 6\n\n테스트 예시: /자동일퀘 또는 ㅇㅋㅋ"
    );
  });
});
