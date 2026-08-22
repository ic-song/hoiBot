import { ApplicationError } from "../shared/application-error.js";
import type {
  GuildTerritoryReadModel,
  GuildTerritoryReadModelRepository,
  GuildTerritoryReadRequest,
  GuildTerritoryRememberPreference,
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
}
