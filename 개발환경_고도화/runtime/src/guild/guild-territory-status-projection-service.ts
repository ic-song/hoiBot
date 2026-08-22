import type { GuildTerritoryReadModelService } from "./guild-territory-read-model-service.js";
import type {
  GuildTerritoryStatusProjection,
  GuildTerritoryStatusSlot
} from "./guild-territory-read-model-repository.js";

const TERRITORY_SCOPE = "world-active";
const TERRITORY_NAMES = [
  "호월킹덤🏰",
  "펫스킬 광산📙",
  "펜던트 광산📿",
  "펫강화광산⭐️",
  "미니펫강화광산💫",
  "다이아광산💎",
  "길드영지PT광산🪙"
] as const;

export type GuildTerritoryStatusCommandResult = {
  status: "projected";
  data: string;
  territoryScope: string;
  eventActive: boolean;
  seasonActive: boolean;
  version: bigint;
} | {
  status: "repair_required";
  reason: "status_projection_missing" | "status_projection_invalid";
  territoryScope: string;
  version: bigint | null;
};

// 길드 영지 상태를 조회하는 두 기존 명령만 정확히 허용합니다.
export function isGuildTerritoryStatusCommand(message: string | undefined): boolean {
  return message === "/길드영지" || message === "/길드영지확인";
}

// live 길드 표시를 우선하고 저장된 이름은 projection 누락 시에만 사용합니다.
function formatOwner(slot: GuildTerritoryStatusSlot): string | null {
  const liveName = slot.ownerGuild?.displayName;
  if (liveName !== null && liveName !== undefined && liveName.length > 0) {
    return liveName + (slot.ownerGuild?.mark ? `(${slot.ownerGuild.mark})` : "");
  }
  if (slot.storedOwnerGuildName !== null && slot.storedOwnerGuildName.length > 0) {
    return slot.storedOwnerGuildName;
  }
  return slot.ownerGuild === null ? "미점령" : null;
}

// 1~7번 slot을 중복이나 누락 없이 고정 순서로 검증합니다.
function readLegacySlots(projection: GuildTerritoryStatusProjection): GuildTerritoryStatusSlot[] | null {
  if (projection.slots.length !== TERRITORY_NAMES.length) return null;
  const bySlot = new Map<number, GuildTerritoryStatusSlot>();
  for (const slot of projection.slots) {
    if (!Number.isInteger(slot.slotNo) || slot.slotNo < 1 || slot.slotNo > TERRITORY_NAMES.length
      || bySlot.has(slot.slotNo)) return null;
    bySlot.set(slot.slotNo, slot);
  }
  const slots = TERRITORY_NAMES.map((_name, index) => bySlot.get(index + 1));
  return slots.some((slot) => slot === undefined) ? null : slots as GuildTerritoryStatusSlot[];
}

// 검증된 provider projection을 기존 /길드영지 출력 형식으로 구성합니다.
function formatLegacyStatus(projection: GuildTerritoryStatusProjection, slots: GuildTerritoryStatusSlot[]): string | null {
  let out = "🎖️현재 길드 영지전 상황🎖️\n━━━━━━━━━━━━\n";
  for (let index = 0; index < slots.length; index += 1) {
    const owner = formatOwner(slots[index]!);
    if (owner === null) return null;
    out += `[${index + 1}] ${TERRITORY_NAMES[index]}: ${owner}\n`;
  }
  out += "━━━━━━━━━━━━\n";
  out += "[8] 차원의 문 🌀: " + (projection.dimensionGateEnabled
    ? "환생 하고싶누?\n(20% 확률 4턴 증가 80% 확률 탈락 -2턴 차감)"
    : "닫힘(OFF)") + "\n";
  out += "[9] 날 기억해줘😭: " + (projection.rememberMeEnabled
    ? "주인공 되고싶누?\n(30% 확률 점령지 1곳 미점령, 공격 1턴 소모)"
    : "닫힘(OFF)") + "\n\n순고한 히셍 간사함니다";
  return out;
}

// 순수 조회만 수행하고 불완전한 상태는 repair 호출 없이 명시적으로 분리합니다.
export class GuildTerritoryStatusProjectionService {
  constructor(private readonly readModel: Pick<GuildTerritoryReadModelService, "read">) {}

  async execute(message: "/길드영지" | "/길드영지확인"): Promise<GuildTerritoryStatusCommandResult> {
    const model = await this.readModel.read({ territoryScope: TERRITORY_SCOPE });
    const projection = model.statusProjection;
    if (projection === null) {
      return { status: "repair_required", reason: "status_projection_missing", territoryScope: TERRITORY_SCOPE, version: null };
    }
    if (projection.territoryScope !== TERRITORY_SCOPE) {
      return { status: "repair_required", reason: "status_projection_invalid", territoryScope: TERRITORY_SCOPE, version: projection.version };
    }
    const slots = readLegacySlots(projection);
    const data = message === "/길드영지확인"
      ? (projection.eventActive
        ? "🏰 현재 길드 영지전이 진행 중입니다.\n지금 바로 참여하실 수 있습니다!"
        : "🏰 현재 진행 중인 길드 영지전이 없습니다.\n다음 영지전을 기다려 주세요.")
      : (slots === null ? null : formatLegacyStatus(projection, slots));
    if (data === null) {
      return { status: "repair_required", reason: "status_projection_invalid", territoryScope: TERRITORY_SCOPE, version: projection.version };
    }
    return {
      status: "projected",
      data,
      territoryScope: projection.territoryScope,
      eventActive: projection.eventActive,
      seasonActive: projection.seasonActive,
      version: projection.version
    };
  }
}
