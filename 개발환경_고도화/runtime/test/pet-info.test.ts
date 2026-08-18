import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PetInfoRepository, PetInfoView } from "../src/pet/pet-info.js";
import { formatLegacyPetInfo, GetPetInfoService, isPetInfoCommand } from "../src/pet/pet-info-service.js";

const starterView: PetInfoView = {
  playerId: "1", displayName: "합성회원 남", tierCode: "seedling",
  pet: { name: "봉봉", typeCode: "legacy-sky", typeName: "하늘", image: "🦃", personality: "다정한", experience: "35000", enhancement: "90" },
  title: null, elemental: { name: "피닉스🐦‍🔥", grade: "정령왕", enhancement: "80" }, pendant: null,
  miniPet: { name: "초보자전용미니펫", emoji: "🌱", grade: "희귀", battleCharm: "100000", enhancement: "0" },
  home: { name: "산이 보이는 텐트집🏕️", charm: "3510", floorArea: "18" },
  intimacy: { level: "0", progress: "0", charm: "0", rank: null }, skill: { equipped: "0", slots: "0" },
  charm: { raid: "138510", castle: "138510", total: "367020", effectiveEnhancement: "90", criticalChance: "45.00", criticalMultiplier: "1.7", rank: null },
  daily: { towerAttempts: "0", towerFloor: "0", castleAttempts: "0", castleScore: "0", castleRank: null,
    miniAttempts: "0", miniWins: "0", miniLosses: "0", exploreAttempts: "0", exploreWins: "0", exploreLosses: "0",
    dailyQuestRewarded: false, weeklyQuestCount: "0", petHomeCommentCount: "0", feedPostCount: "0", homeAlertOpenCount: "0" },
  pass: { base: false, premium: false }
};

describe("pet info command", () => {
  it("accepts only the exact legacy command and two aliases", () => {
    for (const command of ["/펫정보", "/ㅎ", "ㅁㅁㅁ"]) assert.equal(isPetInfoCommand(command), true);
    for (const command of ["/펫정보 1", "/ㅎ 해줘", "ㅁㅁㅁ "]) assert.equal(isPetInfoCommand(command), false);
  });

  it("renders the legacy two-reply sections with exactly 500 all-see characters", () => {
    const replies = formatLegacyPetInfo(starterView, 0);
    assert.equal(replies.length, 2);
    assert.equal(replies[0]?.data, "🦃");
    const text = replies[1]?.data ?? "";
    assert.match(text, /\[🌱합성회원 남\]의 펫정보🐶/);
    assert.match(text, /종합매력👑: 36만💞/);
    assert.match(text, /펫강화⭐️: 90강\(💥45\.00%\)\[1\.7배\]/);
    assert.match(text, /정령🔯: 피닉스🐦‍🔥\[정령왕\]\(\+80\)/);
    assert.match(text, /펜던트💎: 현재 펜던트가 없습니다\./);
    assert.match(text, /주간퀘스트🦋\[0\/7\]/);
    assert.equal((text.match(/​/g) ?? []).length, 500);
  });

  it("reads through the repository and preserves reply order", async () => {
    const repository: PetInfoRepository = { findByExternalIdentity: async () => starterView };
    const replies = await new GetPetInfoService(repository, () => 0).execute("kakao", "synthetic-user");
    assert.equal(replies[0]?.data, "🦃");
    assert.match(replies[1]?.data ?? "", /펫정보🐶/);
  });

  it("renders each pass-only completion icon independently", () => {
    const view: PetInfoView = {
      ...starterView,
      daily: { ...starterView.daily, petHomeCommentCount: "1", feedPostCount: "0", homeAlertOpenCount: "1" },
      pass: { base: true, premium: false }
    };
    assert.match(formatLegacyPetInfo(view, 0)[1]?.data ?? "", /\[🐶호패 전용\]\[💬✅\]\[✍️❌\]\[🔔✅\]/);
  });
});
