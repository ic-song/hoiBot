import { ApplicationError } from "../shared/application-error.js";
import type {
  GuildTerritoryReadModel,
  GuildTerritoryReadModelRepository,
  GuildTerritoryReadRequest,
  GuildTerritoryRememberPreference,
  GuildTerritoryStatusRepairDelta,
  GuildTerritoryStatusRepairResult,
  RepairGuildTerritoryStatus,
  SetGuildTerritoryRememberPreference
} from "./guild-territory-read-model-repository.js";

// Territory scope and player identifiers must be explicit before repository access.
function requireIdentifier(value: string, code: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new ApplicationError(code, "길드 영지 조회 식별자가 비어 있습니다.", 400);
  return normalized;
}

// Snapshot and rule pins must reference a positive immutable version.
function requireVersion(value: bigint, code: string): bigint {
  if (value < 1n) throw new ApplicationError(code, "길드 영지 버전은 1 이상이어야 합니다.", 400);
  return value;
}

// Repair versions allow zero for first-time aggregate bootstrap.
function requireRepairVersion(value: bigint): bigint {
  if (value < 0n) throw new ApplicationError("TERRITORY_STATUS_VERSION_INVALID", "길드 영지 상태 버전은 0 이상이어야 합니다.", 400);
  return value;
}

// Repair deltas are normalized without deriving owner or default values from display text.
function normalizeRepairDelta(delta: GuildTerritoryStatusRepairDelta): GuildTerritoryStatusRepairDelta {
  if (Object.keys(delta).length === 0) throw new ApplicationError("TERRITORY_STATUS_REPAIR_EMPTY", "적용할 길드 영지 상태 보정값이 없습니다.", 400);
  const slots = delta.slots?.map((slot) => ({
    slotNo: slot.slotNo,
    ownerGuildId: slot.ownerGuildId === null ? null : requireIdentifier(slot.ownerGuildId, "TERRITORY_STATUS_OWNER_REQUIRED"),
    storedOwnerGuildName: slot.storedOwnerGuildName === null ? null : requireIdentifier(slot.storedOwnerGuildName, "TERRITORY_STATUS_OWNER_NAME_REQUIRED")
  }));
  if (slots?.some((slot) => !Number.isInteger(slot.slotNo) || slot.slotNo < 1 || slot.slotNo > 7)) {
    throw new ApplicationError("TERRITORY_STATUS_SLOT_INVALID", "길드 영지 슬롯은 1부터 7까지여야 합니다.", 400);
  }
  if (slots !== undefined && new Set(slots.map((slot) => slot.slotNo)).size !== slots.length) {
    throw new ApplicationError("TERRITORY_STATUS_SLOT_DUPLICATE", "같은 길드 영지 슬롯을 중복 보정할 수 없습니다.", 400);
  }
  const normalized = { ...delta };
  if (delta.seasonId !== undefined) {
    normalized.seasonId = delta.seasonId === null ? null : requireIdentifier(delta.seasonId, "TERRITORY_STATUS_SEASON_REQUIRED");
  }
  if (slots !== undefined) normalized.slots = slots;
  return normalized;
}

// Version-pinned guild territory projections and remember preference state are exposed without payout mutation ownership.
export class GuildTerritoryReadModelService {
  constructor(private readonly repository: GuildTerritoryReadModelRepository) {}

  async read(request: GuildTerritoryReadRequest): Promise<GuildTerritoryReadModel> {
    const territoryScope = requireIdentifier(request.territoryScope, "TERRITORY_SCOPE_REQUIRED");
    const seasonPin = request.seasonPin === undefined ? undefined : {
      seasonId: requireIdentifier(request.seasonPin.seasonId, "TERRITORY_SEASON_REQUIRED"),
      snapshotVersion: requireVersion(request.seasonPin.snapshotVersion, "TERRITORY_SNAPSHOT_VERSION_INVALID")
    };
    const rulePin = request.rulePin === undefined ? undefined : {
      territoryScope: requireIdentifier(request.rulePin.territoryScope, "TERRITORY_RULE_SCOPE_REQUIRED"),
      ruleVersion: requireVersion(request.rulePin.ruleVersion, "TERRITORY_RULE_VERSION_INVALID")
    };
    const remember = request.remember === undefined ? undefined : {
      operatorPlayerId: requireIdentifier(request.remember.operatorPlayerId, "TERRITORY_OPERATOR_REQUIRED"),
      playerId: requireIdentifier(request.remember.playerId, "TERRITORY_PLAYER_REQUIRED")
    };
    return this.repository.readConsistent({ territoryScope, seasonPin, rulePin, remember });
  }

  async setRememberPreference(command: SetGuildTerritoryRememberPreference): Promise<GuildTerritoryRememberPreference> {
    return this.repository.setRememberPreference({
      territoryScope: requireIdentifier(command.territoryScope, "TERRITORY_SCOPE_REQUIRED"),
      operatorPlayerId: requireIdentifier(command.operatorPlayerId, "TERRITORY_OPERATOR_REQUIRED"),
      playerId: requireIdentifier(command.playerId, "TERRITORY_PLAYER_REQUIRED"),
      desiredState: command.desiredState
    });
  }

  async repairStatus(command: RepairGuildTerritoryStatus): Promise<GuildTerritoryStatusRepairResult> {
    return this.repository.repairStatus({
      territoryScope: requireIdentifier(command.territoryScope, "TERRITORY_SCOPE_REQUIRED"),
      expectedVersion: requireRepairVersion(command.expectedVersion),
      idempotencyKey: requireIdentifier(command.idempotencyKey, "TERRITORY_STATUS_IDEMPOTENCY_REQUIRED"),
      repairDelta: normalizeRepairDelta(command.repairDelta)
    });
  }
}
