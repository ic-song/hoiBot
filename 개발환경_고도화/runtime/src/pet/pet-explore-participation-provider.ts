import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export type PetExploreParticipationMode = "manual" | "auto";
export type PetExploreParticipationSource = "iris" | "scheduler" | "system";
export type PetExploreDestinationCode =
  | "diamond_mine_event"
  | "pet_enhancement_mine"
  | "intimacy_mine"
  | "luck_mine"
  | "jeondor_dungeon"
  | "chicken_farm_dungeon"
  | "land_document_dungeon"
  | "shop_open_dungeon"
  | "belcar_maze"
  | "archmage_ruins"
  | "guild_raid_event"
  | "regular_mine";

export interface PetExploreParticipationInput {
  mode: PetExploreParticipationMode;
  roundKey: string;
  playerId: string;
  destinationCode: PetExploreDestinationCode;
  expectedRoundVersion: string;
  expectedParticipationVersion: string | null;
  idempotencyKey: string;
  reason: string;
  sourceCode: PetExploreParticipationSource;
}

export interface PetExploreParticipationResult {
  status: "created" | "changed" | "noop";
  detailCode: "created" | "manual_changed" | "same_destination" | "auto_existing" | "ticket_unavailable";
  mode: PetExploreParticipationMode;
  roundId: string;
  roundVersion: string;
  participationId: string | null;
  playerId: string;
  previousDestinationCode: PetExploreDestinationCode | null;
  destinationCode: PetExploreDestinationCode | null;
  previousVersion: string | null;
  version: string | null;
  checkedTicketName: string | null;
  checkedTicketQuantity: string;
  ticketAvailable: boolean;
  operationId: string;
  auditId: string;
  outboxId: string;
  replayed: boolean;
}

interface StoredEnvelope {
  fingerprint: string;
  result: PetExploreParticipationResult;
}

interface RuntimeConfigRow {
  event_mine_active: number;
  guild_raid_active: number;
}

interface RoundRow {
  id: bigint;
  state_code: string;
  version: bigint;
}

interface ParticipationRow {
  id: bigint;
  destination_code: PetExploreDestinationCode;
  state_code: string;
  version: bigint;
}

const SOURCE_SLOT_DESTINATIONS: Readonly<Record<string, PetExploreDestinationCode>> = {
  "0": "diamond_mine_event",
  "1": "pet_enhancement_mine",
  "2": "intimacy_mine",
  "3": "luck_mine",
  "4": "jeondor_dungeon",
  "5": "chicken_farm_dungeon",
  "6": "land_document_dungeon",
  "7": "shop_open_dungeon",
  "8": "belcar_maze",
  "9": "archmage_ruins",
  "10": "guild_raid_event",
};

const DESTINATIONS = new Set<PetExploreDestinationCode>([
  ...Object.values(SOURCE_SLOT_DESTINATIONS),
  "regular_mine",
]);

const AUTO_TICKET_NAME = "자동탐험권🌄";
const MAZE_TICKET_NAME = "미궁 입장권🕋";
const PET_DUNGEON_TICKET_NAME = "펫던전 입장권🌋";

// 레거시 숫자 slot을 DB에 저장하지 않고 canonical destination code로 변환합니다.
export function resolvePetExploreDestinationCode(sourceSlot: string): PetExploreDestinationCode | null {
  return SOURCE_SLOT_DESTINATIONS[sourceSlot] ?? null;
}

// manual/auto namespace까지 포함한 canonical payload fingerprint를 생성합니다.
export function createPetExploreParticipationFingerprint(input: PetExploreParticipationInput): string {
  return createHash("sha256").update(JSON.stringify({
    mode: input.mode,
    roundKey: input.roundKey,
    playerId: input.playerId,
    destinationCode: input.destinationCode,
    expectedRoundVersion: input.expectedRoundVersion,
    expectedParticipationVersion: input.expectedParticipationVersion,
    reason: input.reason.trim(),
    sourceCode: input.sourceCode,
  })).digest("hex");
}

function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new ApplicationError("PET_EXPLORE_PARTICIPATION_IDEMPOTENCY_KEY_INVALID", "Idempotency key가 필요합니다.", 422);
  return normalized.length <= 191 ? normalized : `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

function normalizeVersion(value: string, field: string): string {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new ApplicationError("PET_EXPLORE_PARTICIPATION_VERSION_INVALID", `${field}은 1 이상의 정수 문자열이어야 합니다.`, 422);
  }
  return value;
}

function normalizePlayerId(value: string): string {
  if (!/^[1-9]\d*$/.test(value)) throw new ApplicationError("PET_EXPLORE_PARTICIPATION_PLAYER_INVALID", "playerId는 양의 정수 문자열이어야 합니다.", 422);
  return value;
}

function normalizeRoundKey(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(normalized)) {
    throw new ApplicationError("PET_EXPLORE_PARTICIPATION_ROUND_KEY_INVALID", "roundKey는 1~128자의 stable ASCII key여야 합니다.", 422);
  }
  return normalized;
}

function normalizeReason(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 5 || normalized.length > 500 || /[\u0000-\u001f]/.test(normalized)) {
    throw new ApplicationError("PET_EXPLORE_PARTICIPATION_REASON_INVALID", "사유는 제어문자 없이 5~500자로 입력해주세요.", 422);
  }
  return normalized;
}

function parseEnvelope(value: string | StoredEnvelope): StoredEnvelope {
  return typeof value === "string" ? JSON.parse(value) as StoredEnvelope : value;
}

function ticketNameFor(input: PetExploreParticipationInput): string | null {
  if (input.mode === "auto") return AUTO_TICKET_NAME;
  if (input.destinationCode === "belcar_maze" || input.destinationCode === "archmage_ruins") return MAZE_TICKET_NAME;
  if (input.destinationCode === "guild_raid_event") return PET_DUNGEON_TICKET_NAME;
  return null;
}

function assertSource(mode: PetExploreParticipationMode, sourceCode: PetExploreParticipationSource): void {
  if ((mode === "manual" && sourceCode !== "iris") || (mode === "auto" && sourceCode === "iris")) {
    throw new ApplicationError("PET_EXPLORE_PARTICIPATION_SOURCE_INVALID", "manual/auto 참가 source가 일치하지 않습니다.", 422);
  }
}

// canonical round와 participant를 고정 lock order로 잠그고 예약 상태만 원자 변경합니다.
export class PetExploreParticipationProvider {
  constructor(private readonly database: DatabaseClient) {}

  async reserve(input: PetExploreParticipationInput): Promise<PetExploreParticipationResult> {
    if (!DESTINATIONS.has(input.destinationCode)) {
      throw new ApplicationError("PET_EXPLORE_PARTICIPATION_DESTINATION_INVALID", "지원하지 않는 stable destination code입니다.", 422);
    }
    assertSource(input.mode, input.sourceCode);
    const roundKey = normalizeRoundKey(input.roundKey);
    const playerId = normalizePlayerId(input.playerId);
    const expectedRoundVersion = normalizeVersion(input.expectedRoundVersion, "expectedRoundVersion");
    const expectedParticipationVersion = input.expectedParticipationVersion === null
      ? null
      : normalizeVersion(input.expectedParticipationVersion, "expectedParticipationVersion");
    const reason = normalizeReason(input.reason);
    const key = normalizeIdempotencyKey(input.idempotencyKey);
    const normalizedInput: PetExploreParticipationInput = {
      ...input,
      roundKey,
      playerId,
      expectedRoundVersion,
      expectedParticipationVersion,
      reason,
    };
    const fingerprint = createPetExploreParticipationFingerprint(normalizedInput);
    const scope = `pet_explore.participation.${input.mode}:${playerId}`;

    return this.database.withTransaction(async (transaction) => {
      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,? ,?,'player',?,?,'processing',UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
        [randomUUID(), scope, key, playerId, input.sourceCode],
      );
      const claimed = (await transaction.query<Array<{ result_json: string | StoredEnvelope | null }>>(
        "SELECT result_json FROM operations WHERE id=? FOR UPDATE",
        [operation.insertId],
      ))[0];
      if (claimed === undefined) throw new Error("Pet explore participation operation claim failed.");
      if (claimed.result_json !== null) {
        const stored = parseEnvelope(claimed.result_json);
        if (stored.fingerprint !== fingerprint) {
          throw new ApplicationError(
            "PET_EXPLORE_PARTICIPATION_IDEMPOTENCY_PAYLOAD_MISMATCH",
            "같은 Idempotency key에 다른 참가 요청을 사용할 수 없습니다.",
            409,
          );
        }
        return { ...stored.result, replayed: true };
      }

      // event-control provider와 동일하게 runtime config를 participation보다 먼저 잠급니다.
      const config = (await transaction.query<RuntimeConfigRow[]>(
        "SELECT event_mine_active,guild_raid_active FROM pet_explore_runtime_config WHERE config_id=1 FOR UPDATE",
      ))[0];
      if (config === undefined) throw new Error("Pet explore runtime config is missing.");
      if (input.destinationCode === "diamond_mine_event" && config.event_mine_active !== 1) {
        throw new ApplicationError("PET_EXPLORE_PARTICIPATION_DESTINATION_INACTIVE", "다이아 광산 이벤트가 활성 상태가 아닙니다.", 409);
      }
      if (input.destinationCode === "guild_raid_event" && config.guild_raid_active !== 1) {
        throw new ApplicationError("PET_EXPLORE_PARTICIPATION_DESTINATION_INACTIVE", "길드 레이드 이벤트가 활성 상태가 아닙니다.", 409);
      }

      const round = (await transaction.query<RoundRow[]>(
        "SELECT id,state_code,version FROM pet_explore_rounds WHERE round_key=? FOR UPDATE",
        [roundKey],
      ))[0];
      if (round === undefined) throw new ApplicationError("PET_EXPLORE_ROUND_NOT_FOUND", "펫 탐험 round를 찾을 수 없습니다.", 404);
      if (round.state_code !== "open") throw new ApplicationError("PET_EXPLORE_ROUND_CLOSED", "이미 종료된 펫 탐험 round입니다.", 409);
      if (round.version.toString() !== expectedRoundVersion) {
        throw new ApplicationError("PET_EXPLORE_ROUND_VERSION_CONFLICT", "펫 탐험 round가 먼저 변경되었습니다.", 409, {
          expectedVersion: expectedRoundVersion,
          actualVersion: round.version.toString(),
        });
      }

      const existing = (await transaction.query<ParticipationRow[]>(
        "SELECT id,destination_code,state_code,version FROM pet_explore_participations WHERE round_id=? AND player_id=? FOR UPDATE",
        [round.id, playerId],
      ))[0];
      if (existing !== undefined && existing.state_code !== "active") {
        throw new ApplicationError("PET_EXPLORE_PARTICIPATION_STATE_CONFLICT", "현재 참가 상태는 변경할 수 없습니다.", 409);
      }
      if (existing === undefined && expectedParticipationVersion !== null) {
        throw new ApplicationError("PET_EXPLORE_PARTICIPATION_VERSION_CONFLICT", "참가 정보가 존재하지 않습니다.", 409);
      }
      if (existing !== undefined && input.mode === "manual" && existing.version.toString() !== expectedParticipationVersion) {
        throw new ApplicationError("PET_EXPLORE_PARTICIPATION_VERSION_CONFLICT", "참가 정보가 먼저 변경되었습니다.", 409, {
          expectedVersion: expectedParticipationVersion,
          actualVersion: existing.version.toString(),
        });
      }

      const checkedTicketName = ticketNameFor(normalizedInput);
      let checkedTicketQuantity = 0n;
      if (checkedTicketName !== null) {
        const ticket = (await transaction.query<Array<{ quantity: bigint }>>(
          `SELECT stack.quantity
           FROM item_definitions definition
           LEFT JOIN inventory_stacks stack ON stack.item_id=definition.id AND stack.player_id=?
           WHERE definition.display_name=? AND definition.active=TRUE
           ORDER BY definition.id LIMIT 1 FOR UPDATE`,
          [playerId, checkedTicketName],
        ))[0];
        checkedTicketQuantity = ticket?.quantity ?? 0n;
      }
      const ticketAvailable = checkedTicketName === null || checkedTicketQuantity > 0n;

      let status: PetExploreParticipationResult["status"];
      let detailCode: PetExploreParticipationResult["detailCode"];
      let participationId = existing?.id ?? null;
      let destinationCode: PetExploreDestinationCode | null = existing?.destination_code ?? null;
      let resultingVersion: bigint | null = existing?.version ?? null;

      if (!ticketAvailable) {
        status = "noop";
        detailCode = "ticket_unavailable";
      } else if (input.mode === "auto" && existing !== undefined) {
        status = "noop";
        detailCode = "auto_existing";
      } else if (existing !== undefined && existing.destination_code === input.destinationCode) {
        status = "noop";
        detailCode = "same_destination";
      } else if (existing !== undefined) {
        const update = await transaction.execute(
          `UPDATE pet_explore_participations
           SET destination_code=?,version=version+1,updated_operation_id=?,updated_at=UTC_TIMESTAMP(3)
           WHERE id=? AND version=? AND state_code='active'`,
          [input.destinationCode, operation.insertId, existing.id, existing.version],
        );
        if (update.affectedRows !== 1n) throw new ApplicationError("PET_EXPLORE_PARTICIPATION_VERSION_CONFLICT", "참가 정보가 먼저 변경되었습니다.", 409);
        status = "changed";
        detailCode = "manual_changed";
        destinationCode = input.destinationCode;
        resultingVersion = existing.version + 1n;
      } else {
        const write = await transaction.execute(
          `INSERT INTO pet_explore_participations
            (participation_key,round_id,player_id,destination_code,state_code,version,created_operation_id,updated_operation_id,created_at,updated_at)
           VALUES (?, ?, ?, ?, 'active', 1, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [`${round.id.toString()}:${playerId}`, round.id, playerId, input.destinationCode, operation.insertId, operation.insertId],
        );
        status = "created";
        detailCode = "created";
        participationId = write.insertId;
        destinationCode = input.destinationCode;
        resultingVersion = 1n;
      }

      await transaction.execute(
        `INSERT INTO pet_explore_participation_changes
          (operation_id,participation_id,round_id,player_id,participation_mode,result_code,detail_code,
           previous_destination_code,requested_destination_code,resulting_destination_code,previous_version,resulting_version,
           checked_ticket_name,checked_ticket_quantity)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          operation.insertId,
          participationId,
          round.id,
          playerId,
          input.mode,
          status,
          detailCode,
          existing?.destination_code ?? null,
          input.destinationCode,
          destinationCode,
          existing?.version ?? null,
          resultingVersion,
          checkedTicketName,
          checkedTicketQuantity,
        ],
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'player',?,'pet_explore_participation',?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
        [
          operation.insertId,
          playerId,
          participationId,
          `pet_explore.participation.${input.mode}`,
          status,
          reason,
          JSON.stringify({
            mode: input.mode,
            roundKey,
            roundVersion: round.version.toString(),
            playerId,
            detailCode,
            previousDestinationCode: existing?.destination_code ?? null,
            destinationCode,
            previousVersion: existing?.version.toString() ?? null,
            version: resultingVersion?.toString() ?? null,
            checkedTicketName,
            checkedTicketQuantity: checkedTicketQuantity.toString(),
            ticketAvailable,
          }),
        ],
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'internal',?,'pet_explore.participation',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [
          operation.insertId,
          roundKey,
          JSON.stringify({ mode: input.mode, roundKey, playerId, status, detailCode, destinationCode, version: resultingVersion?.toString() ?? null }),
        ],
      );
      const result: PetExploreParticipationResult = {
        status,
        detailCode,
        mode: input.mode,
        roundId: round.id.toString(),
        roundVersion: round.version.toString(),
        participationId: participationId?.toString() ?? null,
        playerId,
        previousDestinationCode: existing?.destination_code ?? null,
        destinationCode,
        previousVersion: existing?.version.toString() ?? null,
        version: resultingVersion?.toString() ?? null,
        checkedTicketName,
        checkedTicketQuantity: checkedTicketQuantity.toString(),
        ticketAvailable,
        operationId: operation.insertId.toString(),
        auditId: audit.insertId.toString(),
        outboxId: outbox.insertId.toString(),
        replayed: false,
      };
      const envelope: StoredEnvelope = { fingerprint, result };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(envelope), operation.insertId],
      );
      return result;
    });
  }
}
