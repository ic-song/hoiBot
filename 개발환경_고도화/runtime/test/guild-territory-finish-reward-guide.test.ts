import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../src/shared/application-error.js";
import type { GuildTerritoryReadModel, GuildTerritoryRewardGuide } from "../src/guild/guild-territory-read-model-repository.js";
import { GuildTerritoryFinishRewardGuideService, isGuildTerritoryFinishRewardGuideCommand } from "../src/guild/guild-territory-finish-reward-guide.js";

// world-finish/v1의 legacy 7단계 보상 안내 fixture를 생성합니다.
function guide(): GuildTerritoryRewardGuide {
  return {
    pin: { territoryScope: "world-finish", ruleVersion: 1n },
    effectiveFrom: "2026-02-01T00:00:00.000Z",
    tiers: Array.from({ length: 7 }, (_value, index) => ({
      rankFrom: index + 1,
      rankTo: index + 1,
      reward: { synthetic: true },
      guideText: `${index + 1}번 영지 종료 보상`
    }))
  };
}

// reward guide만 포함한 최소 read-model fixture를 생성합니다.
function model(rewardGuide: GuildTerritoryRewardGuide | null): GuildTerritoryReadModel {
  return {
    season: { state: "no-war", season: null },
    pin: null,
    turnOrder: [],
    rankingSnapshot: null,
    rewardGuide,
    rememberPreference: null
  };
}

// 고정 fixture와 정확한 provider pin 요청을 검증하는 service 대역을 생성합니다.
function service(value: GuildTerritoryReadModel) {
  return new GuildTerritoryFinishRewardGuideService({
    read: async (request) => {
      assert.deepEqual(request, {
        territoryScope: "world-finish",
        rulePin: { territoryScope: "world-finish", ruleVersion: 1n }
      });
      return value;
    }
  });
}

describe("guild territory finish reward guide", () => {
  it("accepts only slash and plain exact aliases", () => {
    assert.equal(isGuildTerritoryFinishRewardGuideCommand("/영지종료보상"), true);
    assert.equal(isGuildTerritoryFinishRewardGuideCommand("영지종료보상"), true);
    for (const message of ["/영지종료보상 ", "/영지종료보상 1", " 영지종료보상", "영지종료보상안내", undefined]) {
      assert.equal(isGuildTerritoryFinishRewardGuideCommand(message), false);
    }
  });

  it("joins the pinned seven guide lines in provider order", async () => {
    const result = await service(model(guide())).execute("/영지종료보상");
    assert.equal(result, Array.from({ length: 7 }, (_value, index) => `${index + 1}번 영지 종료 보상`).join("\n"));
  });

  it("rejects missing, mismatched or malformed guides without fallback mutation", async () => {
    await assert.rejects(service(model(null)).execute("영지종료보상"), unavailable);
    const mismatch = guide();
    mismatch.pin.ruleVersion = 2n;
    await assert.rejects(service(model(mismatch)).execute("영지종료보상"), unavailable);
    const malformed = guide();
    malformed.tiers[6]!.rankTo = 10;
    await assert.rejects(service(model(malformed)).execute("영지종료보상"), unavailable);
  });
});

// 종료 보상 안내 불가 오류의 명시적 503 경계를 검증합니다.
function unavailable(error: unknown): boolean {
  return error instanceof ApplicationError
    && error.code === "TERRITORY_FINISH_REWARD_GUIDE_UNAVAILABLE"
    && error.statusCode === 503;
}
