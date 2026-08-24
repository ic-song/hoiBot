import type { GuildTerritoryReadModel, GuildTerritoryTurnOrderEntry } from "./guild-territory-read-model-repository.js";
import type { GuildTerritoryReadModelService } from "./guild-territory-read-model-service.js";

const ALLSEE = "​".repeat(500);
const HEADER = `📜 길드 영지전 공격 순서표 📜\n${ALLSEE}`;

// `/길드영지순서`만 exact command로 허용합니다.
export function isGuildTerritoryTurnOrderCommand(message: string | null | undefined): boolean {
  return message === "/길드영지순서";
}

// provider가 명시적으로 가시성을 보장한 완전한 순번 projection만 선택합니다.
function isVisibleEntry(entry: GuildTerritoryTurnOrderEntry): boolean {
  return entry.visibility.visible
    && entry.player?.rankProjection !== null
    && entry.player?.rankProjection !== undefined
    && entry.guild !== null
    && entry.guild.displayName !== null;
}

// legacy 길드명(마크) 표시 형식을 provider projection으로 재현합니다.
function formatGuild(entry: GuildTerritoryTurnOrderEntry): string {
  const guild = entry.guild!;
  return guild.displayName + (guild.mark ? `(${guild.mark})` : "");
}

// provider 순번을 legacy 공격 순서표 문구와 compact 번호로 변환합니다.
export function formatGuildTerritoryTurnOrder(model: GuildTerritoryReadModel): string {
  if (model.turnOrder.length === 0) return `${HEADER}참여 공격자가 없습니다.`;

  const visibleEntries = model.turnOrder.filter(isVisibleEntry)
    .sort((left, right) => left.ordinal - right.ordinal);
  if (visibleEntries.length === 0) return `${HEADER}남은 공격 대상이 없습니다.`;

  const lines = visibleEntries.map((entry, index) => {
    const rankLabel = entry.player!.rankProjection!.label;
    return `${index + 1}. [${rankLabel}] [${formatGuild(entry)}]`;
  });
  return HEADER + lines.join("\n") + "\n";
}

export class GuildTerritoryTurnOrderCommand {
  constructor(private readonly service: Pick<GuildTerritoryReadModelService, "read">) {}

  // 조회 provider만 호출하며 상태 변경이나 payout 처리를 수행하지 않습니다.
  async execute(): Promise<string> {
    const model = await this.service.read({ territoryScope: "world" });
    return formatGuildTerritoryTurnOrder(model);
  }
}
