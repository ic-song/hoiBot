import { ApplicationError } from "../shared/application-error.js";
import type { GuildTerritoryReadModelService } from "./guild-territory-read-model-service.js";
import type { GuildTerritoryRewardTier } from "./guild-territory-read-model-repository.js";

const LEGACY_RULE_SCOPE = "world";
const LEGACY_RULE_VERSION = 2n;
const LEGACY_TIER_RANGES = [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 10]] as const;
const LEGACY_POINT_MINE_SCORE = 100;

// 길드 영지 순위 보상 안내의 두 기존 별칭만 정확히 허용합니다.
export function isGuildTerritoryRankRewardGuideCommand(message: string | undefined): boolean {
  return message === "/영지순위보상" || message === "/영지보상순위";
}

// provider 보상 JSON에서 길드창고 포인트를 안전한 정수로 읽습니다.
function readFund(tier: GuildTerritoryRewardTier): number {
  if (typeof tier.reward !== "object" || tier.reward === null || Array.isArray(tier.reward)) {
    throw new ApplicationError("TERRITORY_REWARD_GUIDE_INVALID", "길드 영지 순위 보상 기준을 확인할 수 없습니다.", 409);
  }
  const fund = (tier.reward as Record<string, unknown>).fund;
  if (typeof fund !== "number" || !Number.isSafeInteger(fund) || fund < 0) {
    throw new ApplicationError("TERRITORY_REWARD_GUIDE_INVALID", "길드 영지 순위 보상 기준을 확인할 수 없습니다.", 409);
  }
  return fund;
}

// 고정 rule pin의 여섯 legacy 순위 구간을 순서대로 검증합니다.
function readLegacyFunds(tiers: GuildTerritoryRewardTier[]): number[] {
  const ordered = [...tiers].sort((left, right) => left.rankFrom - right.rankFrom);
  if (ordered.length !== LEGACY_TIER_RANGES.length) {
    throw new ApplicationError("TERRITORY_REWARD_GUIDE_INVALID", "길드 영지 순위 보상 기준을 확인할 수 없습니다.", 409);
  }
  return ordered.map((tier, index) => {
    const expected = LEGACY_TIER_RANGES[index]!;
    if (tier.rankFrom !== expected[0] || tier.rankTo !== expected[1]) {
      throw new ApplicationError("TERRITORY_REWARD_GUIDE_INVALID", "길드 영지 순위 보상 기준을 확인할 수 없습니다.", 409);
    }
    return readFund(tier);
  });
}

// 숫자를 기존 길드 영지 안내문의 천 단위 표기로 변환합니다.
function withCommas(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// provider 순위 구간을 기존 길드 영지 보상 안내문과 동일하게 구성합니다.
function formatLegacyGuide(funds: number[]): string {
  let out = "🏅 길드영지 순위 보상 🏅\n\n";
  out += "\"/길드영지순위\"를 기준으로\n";
  out += "매일 저녁 10시 5분에 지급됩니다.\n\n";
  out += "(점령시 길드 영지부스터🔮 소지시 2배 획득\n";
  out += `1위   🅟${withCommas(funds[0]!)}\n`;
  out += `2위   🅟${withCommas(funds[1]!)}\n`;
  out += `3위   🅟${withCommas(funds[2]!)}\n`;
  out += `4위   🅟${withCommas(funds[3]!)}\n`;
  out += `5위   🅟${withCommas(funds[4]!)}\n`;
  out += `6위~10위   🅟${withCommas(funds[5]!)}\n\n`;
  out += "영지pt 획득 기준:\n";
  out += "호월킹덤🏰   50pt\n";
  out += "펫스킬 광산📙   20pt\n";
  out += "펜던트 광산📿   20pt\n";
  out += "펫강화광산⭐️   50pt\n";
  out += "미니펫강화광산💫   50pt\n";
  out += "다이아광산💎   20pt\n";
  out += `길드영지PT광산🪙   ${LEGACY_POINT_MINE_SCORE}pt(부스터 ${LEGACY_POINT_MINE_SCORE}개 적용 시 ${LEGACY_POINT_MINE_SCORE * 2}pt)`;
  out += "\n※ 추가 점수 1pt당 길드영지 부스터🔮 1개 차감";
  return out;
}

// 고정된 보상 규칙 버전을 읽어 지급 mutation 없이 legacy 안내문을 반환합니다.
export class GuildTerritoryRankRewardGuideService {
  constructor(private readonly readModel: Pick<GuildTerritoryReadModelService, "read">) {}

  async execute(): Promise<string> {
    const model = await this.readModel.read({
      territoryScope: "world-active",
      rulePin: { territoryScope: LEGACY_RULE_SCOPE, ruleVersion: LEGACY_RULE_VERSION }
    });
    const guide = model.rewardGuide;
    if (guide === null || guide.pin.territoryScope !== LEGACY_RULE_SCOPE
      || guide.pin.ruleVersion !== LEGACY_RULE_VERSION) {
      throw new ApplicationError("TERRITORY_REWARD_GUIDE_NOT_FOUND", "길드 영지 순위 보상 기준을 확인할 수 없습니다.", 404);
    }
    return formatLegacyGuide(readLegacyFunds(guide.tiers));
  }
}
