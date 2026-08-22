import { ApplicationError } from "../shared/application-error.js";
import type { GuildTerritoryReadModelService } from "./guild-territory-read-model-service.js";
import type { GuildTerritoryReadyEntry } from "./guild-territory-read-model-repository.js";

const LEGACY_TERRITORY_SCOPE = "world-active";
const ALL_SEE = "\u200b".repeat(500);

// 기존 길드 영지전 준비 현황 명령만 정확히 허용합니다.
export function isGuildTerritoryReadyStatusCommand(message: string | undefined): boolean {
  return message === "/길드영지준비확인";
}

// live 길드 표시를 우선하고 projection이 없을 때 저장 당시 길드명만 사용합니다.
function formatGuild(entry: GuildTerritoryReadyEntry): string {
  if (entry.guild === null) return entry.storedGuildName;
  const mark = entry.guild.mark;
  return entry.guild.displayName + (mark === null || mark === "" ? "" : `(${mark})`);
}

// ready entry의 필수 projection을 검증해 누락값을 추정하지 않습니다.
function requireReadyEntry(entry: GuildTerritoryReadyEntry): GuildTerritoryReadyEntry {
  if (!Number.isSafeInteger(entry.ordinal) || entry.ordinal < 1
    || entry.storedGuildName.trim() === "" || entry.preparedBy === null || entry.preparedAt === null) {
    throw new ApplicationError(
      "TERRITORY_READY_STATUS_INVALID",
      "길드영지전 준비 현황을 확인할 수 없습니다.",
      409
    );
  }
  return entry;
}

// stable insertion ordinal을 검증하고 준비 완료 entry만 legacy 순서로 반환합니다.
function readReadyEntries(entries: GuildTerritoryReadyEntry[]): GuildTerritoryReadyEntry[] {
  const readyEntries = entries.filter((entry) => entry.eligible && entry.ready).map(requireReadyEntry);
  const ordered = [...readyEntries].sort((left, right) => left.ordinal - right.ordinal);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index - 1]!.ordinal === ordered[index]!.ordinal) {
      throw new ApplicationError(
        "TERRITORY_READY_STATUS_INVALID",
        "길드영지전 준비 현황을 확인할 수 없습니다.",
        409
      );
    }
  }
  return ordered;
}

// provider 준비 snapshot을 기존 준비 현황 출력 형식으로 변환합니다.
function formatLegacyReadyStatus(entries: GuildTerritoryReadyEntry[]): string {
  if (entries.length === 0) {
    return "📋 길드영지전 준비 현황\n━━━━━━━━━━━━━━\n아직 준비 완료된 길드가 없습니다.";
  }

  let reply = "📋 길드영지전 준비 현황\n";
  reply += "━━━━━━━━━━━━━━\n";
  reply += `참여 준비 길드: ${entries.length}개\n`;
  reply += ALL_SEE;
  entries.forEach((entry, index) => {
    reply += `${index + 1}. [${formatGuild(entry)}]\n`;
    reply += `   준비자: ${entry.preparedBy!.displayName}\n`;
    reply += `   준비시간: ${entry.preparedAt}`;
    if (index < entries.length - 1) reply += "\n\n";
  });
  return reply;
}

// 일관된 시즌·시작 snapshot을 읽어 영지 상태 변경 없이 legacy 응답을 반환합니다.
export class GuildTerritoryReadyStatusService {
  constructor(private readonly readModel: Pick<GuildTerritoryReadModelService, "read">) {}

  async execute(): Promise<string> {
    const model = await this.readModel.read({ territoryScope: LEGACY_TERRITORY_SCOPE });
    const registry = model.readyRegistry;
    if (registry === null || model.season.season === null
      || registry.seasonId !== model.season.season.seasonId || registry.startSnapshotVersion < 1n) {
      throw new ApplicationError(
        "TERRITORY_READY_STATUS_NOT_FOUND",
        "길드영지전 준비 현황을 확인할 수 없습니다.",
        404
      );
    }
    return formatLegacyReadyStatus(readReadyEntries(registry.entries));
  }
}
