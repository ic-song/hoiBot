import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const SPIRIT_RENAME_PREFIX = "/정령이름 ";
const SPIRIT_RENAME_TICKET_CODE = "legacy-spirit-name-change-ticket";
const SPIRIT_RENAME_TICKET_NAME = "정령 이름변경권📝(/정령이름)";

export interface SpiritNameCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface SpiritNameResult {
  status: "renamed" | "blocked_by_castle_siege";
  playerId?: string;
  petId?: string;
  spiritName?: string;
  ticketQuantity?: string;
  outboxId?: string;
  data?: string;
  auditId?: string;
}

interface SpiritNameOwnerRow {
  identity_id: bigint;
  player_id: bigint;
  current_display_name: string;
  rank_emoji: string | null;
}

// Iris 메시지가 레거시 `/정령이름 ` 실행 경계에 해당하는지 판별합니다.
export function isSpiritNameCommandCandidate(message: string | undefined): boolean {
  return message?.startsWith(SPIRIT_RENAME_PREFIX) === true;
}

// 레거시와 동일하게 공백을 포함한 0~10 UTF-16 코드 단위 이름을 추출합니다.
export function parseSpiritNameCommand(message: string): string | null {
  if (!message.startsWith(SPIRIT_RENAME_PREFIX)) return null;
  const name = message.slice(SPIRIT_RENAME_PREFIX.length);
  return name.length <= 10 ? name : null;
}

// 긴 event ID를 operations 멱등성 키 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 컬럼에서 재시도 결과를 복원합니다.
function parseStoredResult(value: string | SpiritNameResult): SpiritNameResult {
  return typeof value === "string" ? JSON.parse(value) as SpiritNameResult : value;
}

// 정령 이름 변경과 변경권 차감·원장·감사·답장을 한 트랜잭션으로 저장합니다.
export class SpiritNameService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: SpiritNameCommand): Promise<SpiritNameResult> {
    if (!isSpiritNameCommandCandidate(command.message)) {
      throw new ApplicationError("INVALID_SPIRIT_NAME_COMMAND", "올바른 명령어 형식: /정령이름 [이름]", 422);
    }

    return this.database.withTransaction(async (transaction) => {
      const activeSieges = await transaction.query<Array<{ active_count: bigint }>>(
        `SELECT COUNT(*) AS active_count FROM castle_battle_seasons
         WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3))
           AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))`
      );
      if ((activeSieges[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege" };

      const owners = await transaction.query<SpiritNameOwnerRow[]>(
        `SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name,
                rank_profile.rank_emoji
         FROM external_identities identity
         JOIN player_profiles profile ON profile.player_id = identity.player_id
         LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id = identity.player_id
         WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
           AND identity.status = 'linked' AND identity.player_id IS NOT NULL
         FOR UPDATE`,
        [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) {
        throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);
      }

      const scope = `pet.spirit_name:${owner.identity_id}`;
      const eventKey = normalizeEventKey(command.eventId);
      const prior = await transaction.query<Array<{ result_json: string | SpiritNameResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
        return parseStoredResult(prior[0].result_json);
      }

      const elementals = await transaction.query<Array<{ player_pet_id: bigint; display_name: string; version: bigint }>>(
        `SELECT elemental.player_pet_id, elemental.display_name, elemental.version
         FROM player_pets pet
         JOIN player_pet_elementals elemental ON elemental.player_pet_id = pet.id
         WHERE pet.player_id = ? FOR UPDATE`,
        [owner.player_id]
      );
      const elemental = elementals[0];
      if (elemental === undefined) {
        throw new ApplicationError("SPIRIT_NOT_FOUND", "정령 이름변경권📝 이(가) 없습니다.", 409);
      }

      const tickets = await transaction.query<Array<{ item_id: bigint; quantity: bigint; version: bigint }>>(
        `SELECT stack.item_id, stack.quantity, stack.version
         FROM item_definitions item
         JOIN inventory_stacks stack ON stack.item_id = item.id AND stack.player_id = ?
         WHERE item.code = ? AND item.active = TRUE AND item.stackable = TRUE
         FOR UPDATE`,
        [owner.player_id, SPIRIT_RENAME_TICKET_CODE]
      );
      const ticket = tickets[0];
      const rankName = `${owner.rank_emoji ?? ""}${owner.current_display_name}`;
      if (ticket === undefined || ticket.quantity < 1n) {
        throw new ApplicationError(
          "SPIRIT_RENAME_TICKET_REQUIRED",
          `[${rankName}]님 ${SPIRIT_RENAME_TICKET_NAME}이 없습니다.`,
          409
        );
      }

      const spiritName = parseSpiritNameCommand(command.message);
      if (spiritName === null) {
        throw new ApplicationError(
          "SPIRIT_NAME_TOO_LONG",
          `[${rankName}]님 10글자까지 정령 이름 변경이 가능합니다.`,
          422
        );
      }

      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
         VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, owner.identity_id]
      );
      const spiritUpdate = await transaction.execute(
        "UPDATE player_pet_elementals SET display_name = ?, version = version + 1 WHERE player_pet_id = ? AND version = ?",
        [spiritName, elemental.player_pet_id, elemental.version]
      );
      if (spiritUpdate.affectedRows !== 1n) {
        throw new ApplicationError("SPIRIT_NAME_CONFLICT", "정령 정보가 먼저 변경되었습니다.", 409);
      }

      const ticketQuantity = ticket.quantity - 1n;
      const ticketUpdate = await transaction.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [ticketQuantity, owner.player_id, ticket.item_id, ticket.version]
      );
      if (ticketUpdate.affectedRows !== 1n) {
        throw new ApplicationError("INVENTORY_VERSION_CONFLICT", "인벤토리가 먼저 변경되었습니다.", 409);
      }
      await transaction.execute(
        `INSERT INTO inventory_ledger
          (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code)
         VALUES (?, 1, ?, ?, -1, 'spirit_name_ticket_used')`,
        [operation.insertId, owner.player_id, ticket.item_id]
      );

      const data = "정령이름 변경이 완료되었습니다.";
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
         VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
         VALUES (?, 'SPIRIT_NAME_MUTATE', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [command.eventId, operation.insertId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
         VALUES (?, 'external_identity', ?, 'player_pet_elemental', ?, 'spirit.name', 'success', 'Iris /정령이름', ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, owner.identity_id, elemental.player_pet_id, JSON.stringify({
          previousName: elemental.display_name,
          spiritName,
          ticketCode: SPIRIT_RENAME_TICKET_CODE,
          ticketQuantity: ticketQuantity.toString()
        })]
      );
      const result: SpiritNameResult = {
        status: "renamed",
        playerId: owner.player_id.toString(),
        petId: elemental.player_pet_id.toString(),
        spiritName,
        ticketQuantity: ticketQuantity.toString(),
        outboxId: outbox.insertId.toString(),
        data,
        auditId: audit.insertId.toString()
      };
      await transaction.execute(
        "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }
}
