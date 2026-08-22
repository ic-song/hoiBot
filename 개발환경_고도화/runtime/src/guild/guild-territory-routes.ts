import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ApplicationError } from "../shared/application-error.js";
import type { GuildTerritoryReadModelService } from "./guild-territory-read-model-service.js";
import type {
  GuildTerritoryPlayerProjection,
  GuildTerritoryReadModel,
  GuildTerritoryRememberPreference,
  GuildTerritoryStatusRepairDelta
} from "./guild-territory-read-model-repository.js";

const READ_QUERY_KEYS = new Set([
  "territoryScope", "seasonId", "snapshotVersion", "ruleScope", "ruleVersion", "operatorPlayerId", "playerId"
]);
const REMEMBER_BODY_KEYS = new Set(["territoryScope", "operatorPlayerId", "playerId", "desiredState"]);
const REPAIR_BODY_KEYS = new Set(["territoryScope", "expectedVersion", "idempotencyKey", "repairDelta"]);
const REPAIR_DELTA_KEYS = new Set(["seasonId", "eventActive", "seasonActive", "dimensionGateEnabled", "rememberMeEnabled", "slots"]);
const REPAIR_SLOT_KEYS = new Set(["slotNo", "ownerGuildId", "storedOwnerGuildName"]);

interface GuildTerritoryRouteDependencies {
  service: Pick<GuildTerritoryReadModelService, "read" | "setRememberPreference" | "repairStatus">;
  tokenGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

// Nested player rank versions are serialized without precision loss.
function serializePlayer(player: GuildTerritoryPlayerProjection | null) {
  return player === null ? null : {
    ...player,
    rankProjection: player.rankProjection === null ? null : {
      ...player.rankProjection,
      version: player.rankProjection.version.toString()
    }
  };
}

// HTTP query and body values must be plain records with no free-form fields.
function requireRecord(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApplicationError(code, "길드 영지 요청 형식이 올바르지 않습니다.", 400);
  }
  return value as Record<string, unknown>;
}

// Unknown fields are rejected so suffix-like inputs cannot silently alter dispatch behavior.
function requireExactKeys(record: Record<string, unknown>, allowed: Set<string>, code: string): void {
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new ApplicationError(code, "길드 영지 요청에 허용되지 않은 필드가 있습니다.", 400);
  }
}

// Required identifiers are accepted only as non-empty strings.
function requireString(record: Record<string, unknown>, key: string, code: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApplicationError(code, `${key} 값이 필요합니다.`, 400);
  }
  return value.trim();
}

// Optional identifiers preserve absence but reject arrays and empty values.
function readOptionalString(record: Record<string, unknown>, key: string, code: string): string | undefined {
  return record[key] === undefined ? undefined : requireString(record, key, code);
}

// Version pins use canonical positive decimal strings only.
function readOptionalVersion(record: Record<string, unknown>, key: string, code: string): bigint | undefined {
  const value = readOptionalString(record, key, code);
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value)) throw new ApplicationError(code, `${key} 값은 1 이상의 정수여야 합니다.`, 400);
  return BigInt(value);
}

// Repair expectedVersion accepts canonical non-negative decimal strings.
function requireRepairVersion(record: Record<string, unknown>): bigint {
  const value = requireString(record, "expectedVersion", "TERRITORY_STATUS_VERSION_INVALID");
  if (!/^\d+$/.test(value)) throw new ApplicationError("TERRITORY_STATUS_VERSION_INVALID", "expectedVersion 값은 0 이상의 정수여야 합니다.", 400);
  return BigInt(value);
}

// Nullable string fields preserve explicit clears while rejecting other value types.
function readNullableString(record: Record<string, unknown>, key: string, code: string): string | null {
  return record[key] === null ? null : requireString(record, key, code);
}

// Repair delta fields are exact and typed before entering the service boundary.
function requireRepairDelta(value: unknown): GuildTerritoryStatusRepairDelta {
  const delta = requireRecord(value, "TERRITORY_STATUS_REPAIR_DELTA_REQUIRED");
  requireExactKeys(delta, REPAIR_DELTA_KEYS, "TERRITORY_STATUS_REPAIR_FIELD_INVALID");
  for (const key of ["eventActive", "seasonActive", "dimensionGateEnabled", "rememberMeEnabled"] as const) {
    if (delta[key] !== undefined && typeof delta[key] !== "boolean") {
      throw new ApplicationError("TERRITORY_STATUS_REPAIR_FIELD_INVALID", `${key} 값은 boolean이어야 합니다.`, 400);
    }
  }
  if (delta.seasonId !== undefined && delta.seasonId !== null && typeof delta.seasonId !== "string") {
    throw new ApplicationError("TERRITORY_STATUS_REPAIR_FIELD_INVALID", "seasonId 값이 올바르지 않습니다.", 400);
  }
  if (delta.slots !== undefined && !Array.isArray(delta.slots)) {
    throw new ApplicationError("TERRITORY_STATUS_REPAIR_FIELD_INVALID", "slots 값은 배열이어야 합니다.", 400);
  }
  const slots = delta.slots?.map((value) => {
    const slot = requireRecord(value, "TERRITORY_STATUS_SLOT_REQUIRED");
    requireExactKeys(slot, REPAIR_SLOT_KEYS, "TERRITORY_STATUS_SLOT_FIELD_INVALID");
    if (typeof slot.slotNo !== "number") throw new ApplicationError("TERRITORY_STATUS_SLOT_INVALID", "slotNo 값이 필요합니다.", 400);
    return {
      slotNo: slot.slotNo,
      ownerGuildId: readNullableString(slot, "ownerGuildId", "TERRITORY_STATUS_OWNER_INVALID"),
      storedOwnerGuildName: readNullableString(slot, "storedOwnerGuildName", "TERRITORY_STATUS_OWNER_NAME_INVALID")
    };
  });
  const result: GuildTerritoryStatusRepairDelta = {};
  if (delta.seasonId !== undefined) result.seasonId = delta.seasonId as string | null;
  if (delta.eventActive !== undefined) result.eventActive = delta.eventActive as boolean;
  if (delta.seasonActive !== undefined) result.seasonActive = delta.seasonActive as boolean;
  if (delta.dimensionGateEnabled !== undefined) result.dimensionGateEnabled = delta.dimensionGateEnabled as boolean;
  if (delta.rememberMeEnabled !== undefined) result.rememberMeEnabled = delta.rememberMeEnabled as boolean;
  if (slots !== undefined) result.slots = slots;
  return result;
}

// A two-field pin must be wholly present or wholly absent.
function requirePair(left: unknown, right: unknown, code: string): void {
  if ((left === undefined) !== (right === undefined)) {
    throw new ApplicationError(code, "길드 영지 pin 필드는 함께 전달해야 합니다.", 400);
  }
}

// BigInt domain values are converted to stable decimal strings at the HTTP boundary.
function serializeReadModel(model: GuildTerritoryReadModel) {
  return {
    ...model,
    season: {
      ...model.season,
      season: model.season.season === null ? null : {
        ...model.season.season,
        snapshotVersion: model.season.season.snapshotVersion?.toString() ?? null
      }
    },
    pin: model.pin === null ? null : { ...model.pin, snapshotVersion: model.pin.snapshotVersion.toString() },
    turnOrder: model.turnOrder.map((entry) => ({ ...entry, player: serializePlayer(entry.player) })),
    readyRegistry: model.readyRegistry === null ? null : {
      ...model.readyRegistry,
      startSnapshotVersion: model.readyRegistry.startSnapshotVersion.toString()
    },
    statusProjection: model.statusProjection === null ? null : {
      ...model.statusProjection,
      version: model.statusProjection.version.toString()
    },
    rankingSnapshot: model.rankingSnapshot === null ? null : {
      ...model.rankingSnapshot,
      pin: { ...model.rankingSnapshot.pin, snapshotVersion: model.rankingSnapshot.pin.snapshotVersion.toString() },
      rulePin: { ...model.rankingSnapshot.rulePin, ruleVersion: model.rankingSnapshot.rulePin.ruleVersion.toString() },
      entries: model.rankingSnapshot.entries.map((entry) => ({
        ...entry,
        guild: entry.guild === null ? null : { ...entry.guild, master: serializePlayer(entry.guild.master) },
        score: entry.score.toString()
      }))
    },
    rewardGuide: model.rewardGuide === null ? null : {
      ...model.rewardGuide,
      pin: { ...model.rewardGuide.pin, ruleVersion: model.rewardGuide.pin.ruleVersion.toString() }
    },
    rememberPreference: model.rememberPreference === null ? null : serializeRemember(model.rememberPreference)
  };
}

// Remember preference versions are serialized without precision loss.
function serializeRemember(preference: GuildTerritoryRememberPreference) {
  return { ...preference, version: preference.version.toString() };
}

// Exact provider routes expose read-only projection and explicit desired-state mutation separately.
export function registerGuildTerritoryRoutes(app: FastifyInstance, dependencies: GuildTerritoryRouteDependencies): void {
  app.get("/api/v1/providers/guild-territory/read-model", { preHandler: dependencies.tokenGuard }, async (request) => {
    const query = requireRecord(request.query, "TERRITORY_QUERY_REQUIRED");
    requireExactKeys(query, READ_QUERY_KEYS, "TERRITORY_QUERY_FIELD_INVALID");
    const territoryScope = requireString(query, "territoryScope", "TERRITORY_SCOPE_REQUIRED");
    const seasonId = readOptionalString(query, "seasonId", "TERRITORY_SEASON_INVALID");
    const snapshotVersion = readOptionalVersion(query, "snapshotVersion", "TERRITORY_SNAPSHOT_VERSION_INVALID");
    const ruleScope = readOptionalString(query, "ruleScope", "TERRITORY_RULE_SCOPE_INVALID");
    const ruleVersion = readOptionalVersion(query, "ruleVersion", "TERRITORY_RULE_VERSION_INVALID");
    const operatorPlayerId = readOptionalString(query, "operatorPlayerId", "TERRITORY_OPERATOR_INVALID");
    const playerId = readOptionalString(query, "playerId", "TERRITORY_PLAYER_INVALID");
    requirePair(seasonId, snapshotVersion, "TERRITORY_SEASON_PIN_INCOMPLETE");
    requirePair(ruleScope, ruleVersion, "TERRITORY_RULE_PIN_INCOMPLETE");
    requirePair(operatorPlayerId, playerId, "TERRITORY_REMEMBER_IDENTITY_INCOMPLETE");
    const data = await dependencies.service.read({
      territoryScope,
      seasonPin: seasonId === undefined ? undefined : { seasonId, snapshotVersion: snapshotVersion! },
      rulePin: ruleScope === undefined ? undefined : { territoryScope: ruleScope, ruleVersion: ruleVersion! },
      remember: operatorPlayerId === undefined ? undefined : { operatorPlayerId, playerId: playerId! }
    });
    return { ok: true, data: serializeReadModel(data), requestId: request.id };
  });

  app.put("/api/v1/providers/guild-territory/remember-preference", { preHandler: dependencies.tokenGuard }, async (request) => {
    const body = requireRecord(request.body, "TERRITORY_REMEMBER_BODY_REQUIRED");
    requireExactKeys(body, REMEMBER_BODY_KEYS, "TERRITORY_REMEMBER_FIELD_INVALID");
    if (typeof body.desiredState !== "boolean") {
      throw new ApplicationError("TERRITORY_DESIRED_STATE_REQUIRED", "desiredState boolean 값이 필요합니다.", 400);
    }
    const data = await dependencies.service.setRememberPreference({
      territoryScope: requireString(body, "territoryScope", "TERRITORY_SCOPE_REQUIRED"),
      operatorPlayerId: requireString(body, "operatorPlayerId", "TERRITORY_OPERATOR_REQUIRED"),
      playerId: requireString(body, "playerId", "TERRITORY_PLAYER_REQUIRED"),
      desiredState: body.desiredState
    });
    return { ok: true, data: serializeRemember(data), requestId: request.id };
  });

  app.put("/api/v1/providers/guild-territory/status/repair", { preHandler: dependencies.tokenGuard }, async (request) => {
    const body = requireRecord(request.body, "TERRITORY_STATUS_REPAIR_BODY_REQUIRED");
    requireExactKeys(body, REPAIR_BODY_KEYS, "TERRITORY_STATUS_REPAIR_BODY_FIELD_INVALID");
    const data = await dependencies.service.repairStatus({
      territoryScope: requireString(body, "territoryScope", "TERRITORY_SCOPE_REQUIRED"),
      expectedVersion: requireRepairVersion(body),
      idempotencyKey: requireString(body, "idempotencyKey", "TERRITORY_STATUS_IDEMPOTENCY_REQUIRED"),
      repairDelta: requireRepairDelta(body.repairDelta)
    });
    return { ok: true, data: { ...data, version: data.version.toString() }, requestId: request.id };
  });
}
