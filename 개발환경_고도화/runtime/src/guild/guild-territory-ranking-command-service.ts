import type { GuildTerritoryRankingEntry } from "./guild-territory-read-model-repository.js";
import type { GuildTerritoryReadModelService } from "./guild-territory-read-model-service.js";

const TERRITORY_SCOPE = "world-active";
const ALLSEE = "\u200b".repeat(500);

type CompleteRankingEntry = GuildTerritoryRankingEntry & {
  guild: NonNullable<GuildTerritoryRankingEntry["guild"]> & {
    serverCode: string;
    master: NonNullable<NonNullable<GuildTerritoryRankingEntry["guild"]>["master"]> & {
      rankProjection: NonNullable<NonNullable<NonNullable<GuildTerritoryRankingEntry["guild"]>["master"]>["rankProjection"]>;
    };
  };
};

export function isGuildTerritoryRankingCommand(message: string | undefined): boolean {
  return message === "/길드영지순위";
}

// Legacy ranking output only accepts complete provider projections and never infers missing values.
function isCompleteRankingEntry(entry: GuildTerritoryRankingEntry): entry is CompleteRankingEntry {
  const guild = entry.guild;
  return entry.score > 0n
    && guild !== null
    && guild.displayName !== null
    && guild.displayName.trim().length > 0
    && guild.serverCode !== null
    && guild.serverCode.trim().length > 0
    && Number.isInteger(guild.level)
    && guild.level > 0
    && guild.master !== null
    && guild.master.displayName.trim().length > 0
    && guild.master.rankProjection !== null
    && guild.master.rankProjection.label.trim().length > 0;
}

// BigInt scores are grouped without converting them to an unsafe Number.
function formatScore(score: bigint): string {
  return score.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Complete ranking rows retain provider order while filtered ranks remain compact.
function formatLegacyRanking(entries: GuildTerritoryRankingEntry[]): string {
  const rows = entries.filter(isCompleteRankingEntry);
  let output = "📈 🏅 길드영지 순위 🏅 📈\n\n";
  output += "━━━━━━━━━━━\n";
  output += "영지pt 획득 기준\n";
  output += "(추가 점수 1pt당 길드영지 부스터🔮 1개 차감)\n";
  output += "호월킹덤🏰 50pt\n";
  output += "펫스킬 광산📙 20pt\n";
  output += "펜던트 광산📿 20pt\n";
  output += "펫강화광산⭐️ 50pt\n";
  output += "미니펫강화광산💫 50pt\n";
  output += "다이아광산💎 20pt\n";
  output += "길드영지PT광산🪙 100pt(부스터 100개 적용 시 200pt)\n";
  output += "━━━━━━━━━━━\n";
  if (rows.length === 0) return output + "아직 누적 영지점수가 없습니다.";

  rows.forEach((entry, index) => {
    if (index === 3) output += `⭐ 다른 길드 보러가기.. 👉 (4등부터~)\n${ALLSEE}\n`;
    const guild = entry.guild;
    const master = guild.master;
    output += `${index + 1}. ${guild.displayName}${guild.mark ? `(${guild.mark})` : ""}\n`;
    output += `[${guild.serverCode}]\n`;
    output += `[${master.rankProjection.label}${master.displayName}][Lv.${guild.level}]\n`;
    output += `[누적 영지점수: ${formatScore(entry.score)}pt]\n\n`;
  });

  return output.replace(/\n\n$/, "");
}

// Exact legacy command reads the version-pinned provider projection without payout mutation ownership.
export class GuildTerritoryRankingCommandService {
  constructor(private readonly readModel: Pick<GuildTerritoryReadModelService, "read">) {}

  async execute(): Promise<string> {
    const model = await this.readModel.read({ territoryScope: TERRITORY_SCOPE });
    return formatLegacyRanking(model.rankingSnapshot?.entries ?? []);
  }
}
