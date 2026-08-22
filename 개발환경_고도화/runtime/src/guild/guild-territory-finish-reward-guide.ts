import { ApplicationError } from "../shared/application-error.js";
import type { GuildTerritoryReadModelService } from "./guild-territory-read-model-service.js";

const COMMAND_ALIASES = new Set(["/영지종료보상", "영지종료보상"]);
const FINISH_RULE_SCOPE = "world-finish";
const FINISH_RULE_VERSION = 1n;
const LEGACY_TIER_COUNT = 7;

// 영지 종료 보상 안내의 slash/plain exact alias만 소비자 대상으로 판별합니다.
export function isGuildTerritoryFinishRewardGuideCommand(message: string | undefined): boolean {
  return message !== undefined && COMMAND_ALIASES.has(message);
}

// version-pinned provider read를 legacy 7-tier 안내 문자열로 변환합니다.
export class GuildTerritoryFinishRewardGuideService {
  constructor(private readonly provider: Pick<GuildTerritoryReadModelService, "read">) {}

  async execute(message: string): Promise<string> {
    if (!isGuildTerritoryFinishRewardGuideCommand(message)) {
      throw new ApplicationError("INVALID_TERRITORY_FINISH_REWARD_GUIDE_COMMAND", "지원하지 않는 명령어입니다.", 422);
    }

    const model = await this.provider.read({
      territoryScope: FINISH_RULE_SCOPE,
      rulePin: { territoryScope: FINISH_RULE_SCOPE, ruleVersion: FINISH_RULE_VERSION }
    });
    const guide = model.rewardGuide;
    const hasLegacyTierShape = guide !== null
      && guide.pin.territoryScope === FINISH_RULE_SCOPE
      && guide.pin.ruleVersion === FINISH_RULE_VERSION
      && guide.tiers.length === LEGACY_TIER_COUNT
      && guide.tiers.every((tier, index) => tier.rankFrom === index + 1 && tier.rankTo === index + 1);

    if (!hasLegacyTierShape) {
      throw new ApplicationError(
        "TERRITORY_FINISH_REWARD_GUIDE_UNAVAILABLE",
        "영지 종료 보상 안내를 불러올 수 없습니다.",
        503
      );
    }
    return guide.tiers.map((tier) => tier.guideText).join("\n");
  }
}
