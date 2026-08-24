import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GuildTerritoryReadModel } from "../src/guild/guild-territory-read-model-repository.js";
import {
  GuildTerritoryRankRewardGuideService,
  isGuildTerritoryRankRewardGuideCommand,
} from "../src/guild/guild-territory-rank-reward-guide-service.js";

const funds = [500000000, 400000000, 300000000, 200000000, 100000000, 50000000];

// world@2 보상 pin을 반환하는 최소 read-model fixture를 생성합니다.
function model(overrides: Partial<GuildTerritoryReadModel> = {}): GuildTerritoryReadModel {
  return {
    season: { state: "no-war", season: null },
    pin: null,
    turnOrder: [],
    rankingSnapshot: null,
    rememberPreference: null,
    rewardGuide: {
      pin: { territoryScope: "world", ruleVersion: 2n },
      effectiveFrom: "2026-02-01 00:00:00.000",
      tiers: funds.map((fund, index) => ({
        rankFrom: index < 5 ? index + 1 : 6,
        rankTo: index < 5 ? index + 1 : 10,
        reward: { fund },
        guideText: `tier-${index + 1}`,
      })),
    },
    ...overrides,
  };
}

// 고정 fixture를 반환하는 조회 전용 service 대역을 생성합니다.
function service(value: GuildTerritoryReadModel) {
  return new GuildTerritoryRankRewardGuideService({
    read: async (request) => {
      assert.deepEqual(request, { territoryScope: "world-active", rulePin: { territoryScope: "world", ruleVersion: 2n } });
      return value;
    },
  });
}

describe("guild territory rank reward guide", () => {
  it("accepts only the two legacy exact aliases", () => {
    assert.equal(isGuildTerritoryRankRewardGuideCommand("/영지순위보상"), true);
    assert.equal(isGuildTerritoryRankRewardGuideCommand("/영지보상순위"), true);
    for (const message of [" /영지순위보상", "/영지순위보상 ", "/영지순위보상1", "/영지보상순위 안내", undefined]) {
      assert.equal(isGuildTerritoryRankRewardGuideCommand(message), false);
    }
  });

  it("formats the pinned six tiers exactly like the legacy guide", async () => {
    const result = await service(model()).execute();
    assert.equal(result, [
      "🏅 길드영지 순위 보상 🏅", "", "\"/길드영지순위\"를 기준으로", "매일 저녁 10시 5분에 지급됩니다.", "",
      "(점령시 길드 영지부스터🔮 소지시 2배 획득", "1위   🅟500,000,000", "2위   🅟400,000,000",
      "3위   🅟300,000,000", "4위   🅟200,000,000", "5위   🅟100,000,000", "6위~10위   🅟50,000,000", "",
      "영지pt 획득 기준:", "호월킹덤🏰   50pt", "펫스킬 광산📙   20pt", "펜던트 광산📿   20pt",
      "펫강화광산⭐️   50pt", "미니펫강화광산💫   50pt", "다이아광산💎   20pt",
      "길드영지PT광산🪙   100pt(부스터 100개 적용 시 200pt)", "※ 추가 점수 1pt당 길드영지 부스터🔮 1개 차감",
    ].join("\n"));
  });

  it("rejects a missing pin, malformed tier range, and invalid fund", async () => {
    await assert.rejects(() => service(model({ rewardGuide: null })).execute(), /보상 기준/);
    const malformedRange = model();
    malformedRange.rewardGuide!.tiers[5] = { ...malformedRange.rewardGuide!.tiers[5]!, rankTo: 9 };
    await assert.rejects(() => service(malformedRange).execute(), /보상 기준/);
    const malformedFund = model();
    malformedFund.rewardGuide!.tiers[0] = { ...malformedFund.rewardGuide!.tiers[0]!, reward: { fund: 1.5 } };
    await assert.rejects(() => service(malformedFund).execute(), /보상 기준/);
  });
});
