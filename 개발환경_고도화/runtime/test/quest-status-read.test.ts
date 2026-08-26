import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatQuestStatusReply,
  isQuestStatusReadCommandCandidate,
  QuestStatusReadService,
  type QuestStatusProjection
} from "../src/quest/quest-status-read-service.js";

const base: QuestStatusProjection = {
  playerId: "7", displayName: "합성회원", towerUsed: "15", castleUsed: "14", miniUsed: "15", exploreUsed: "10",
  weeklyUsed: "9", dailyRewardDone: true, petHomeCommentUsed: "1", feedPostUsed: "0", homeAlertOpenUsed: "1",
  passDailyRewardDone: true, premiumDailyRewardDone: false, hasBasePass: true, hasPremiumPass: true
};

describe("quest status read", () => {
  it("accepts only the three exact trimmed legacy aliases", () => {
    for (const command of ["/퀘스트", "ㄹㄹㄹ", "/ㅋ", "  /퀘스트  "]) assert.equal(isQuestStatusReadCommandCandidate(command), true);
    for (const command of ["/퀘스트 1", "/ㅋ 안내", "퀘스트", "/퀘스트완료"]) assert.equal(isQuestStatusReadCommandCandidate(command), false);
  });

  it("preserves pass, daily, weekly, completion and allsee output", () => {
    const reply = formatQuestStatusReply(base, "⭐합성회원", "<ALLSEE>");
    assert.ok(reply.startsWith("[⭐합성회원] 님\n📜 일일 · 주간 · 🐶호패,초패🐥"));
    assert.ok(reply.includes("캐대전🏆[14/15][❌]"));
    assert.ok(reply.includes("일일 퀘스트 7번 완료📜(7/7)"));
    assert.ok(reply.includes("[✅ 금일 호패,초패 일퀘 보상 지급 완료]"));
    assert.ok(reply.includes("📜일일,주간퀘스트 보상 명령어 안내📜<ALLSEE>"));
  });

  it("keeps non-member and unknown-command paths mutation-free", async () => {
    let reads = 0;
    const service = new QuestStatusReadService({ findByExternalIdentity: async () => { reads += 1; return null; } }, async () => "unused", "<ALLSEE>");
    assert.equal(await service.read("kakao", "missing", "/퀘스트"), null);
    assert.equal(await service.read("kakao", "missing", "/퀘스트 1"), null);
    assert.equal(reads, 1);
    const noPass = formatQuestStatusReply({ ...base, hasBasePass: false, hasPremiumPass: false }, "합성회원", "<ALLSEE>");
    assert.ok(noPass.includes("펫홈 댓글 달성📝[호패,초패 회원전용]"));
    assert.equal(noPass.includes("《🎁 호패,초패 퀘스트 보상》"), false);
  });
});
