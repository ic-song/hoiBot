import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const SEASONED_CHICKEN_CODE = "ITEM-RWD-SEASONED-CHICKEN";
const SPIRIT_RENAME_TICKET_CODE = "legacy-spirit-name-change-ticket";
const REQUIRED_CHICKEN = 100n;

export interface SpiritNameCombineCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface SpiritNameCombineResult {
  status: "crafted" | "blocked_by_castle_siege";
  playerId?: string;
  chickenQuantity?: string;
  ticketQuantity?: string;
  outboxId?: string;
  data?: string;
  auditId?: string;
}

interface CombineOwnerRow {
  identity_id: bigint;
  player_id: bigint;
  current_display_name: string;
  rank_emoji: string | null;
}

interface CombineItemRow {
  item_id: bigint;
  code: string;
  quantity: bigint | null;
  stack_version: bigint | null;
}

// `/정령이름조합` exact 명령만 실제 변경 후보로 허용합니다.
export function isSpiritNameCombineCommand(message: string | undefined): boolean {
  return message === "/정령이름조합";
}

// 긴 event ID를 operations 멱등성 키 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 컬럼에서 재시도 결과를 복원합니다.
function parseStoredResult(value: string | SpiritNameCombineResult): SpiritNameCombineResult {
  return typeof value === "string" ? JSON.parse(value) as SpiritNameCombineResult : value;
}

// 양념치킨 차감과 정령 이름변경권 지급·원장·감사·답장을 한 트랜잭션으로 저장합니다.
export class SpiritNameCombineService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: SpiritNameCombineCommand): Promise<SpiritNameCombineResult> {
    if (!isSpiritNameCombineCommand(command.message)) {
      throw new ApplicationError("INVALID_SPIRIT_NAME_COMBINE_COMMAND", "정확히 /정령이름조합을 입력해주세요.", 422);
    }

    return this.database.withTransaction(async (transaction) => {
      const activeSieges = await transaction.query<Array<{ active_count: bigint }>>(
        `SELECT COUNT(*) AS active_count FROM castle_battle_seasons
         WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3))
           AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))`
      );
      if ((activeSieges[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege" };

      const owners = await transaction.query<CombineOwnerRow[]>(
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

      const scope = `pet.spirit_name_combine:${owner.identity_id}`;
      const eventKey = normalizeEventKey(command.eventId);
      const prior = await transaction.query<Array<{ result_json: string | SpiritNameCombineResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
        return parseStoredResult(prior[0].result_json);
      }

      const items = await transaction.query<CombineItemRow[]>(
        `SELECT item.id AS item_id, item.code, stack.quantity,
                stack.version AS stack_version
         FROM item_definitions item
         LEFT JOIN inventory_stacks stack ON stack.item_id = item.id AND stack.player_id = ?
         WHERE item.code IN (?, ?) AND item.active = TRUE AND item.stackable = TRUE
         ORDER BY item.code FOR UPDATE`,
        [owner.player_id, SEASONED_CHICKEN_CODE, SPIRIT_RENAME_TICKET_CODE]
      );
      const chicken = items.find((row) => row.code === SEASONED_CHICKEN_CODE);
      const ticket = items.find((row) => row.code === SPIRIT_RENAME_TICKET_CODE);
      if (chicken === undefined || chicken.stack_version === null || chicken.quantity === null || chicken.quantity < REQUIRED_CHICKEN) {
        throw new ApplicationError("SEASONED_CHICKEN_REQUIRED", "양념치킨🐔 100개가 필요합니다.", 409);
      }
      if (ticket === undefined) {
        throw new ApplicationError("SPIRIT_RENAME_TICKET_ITEM_REQUIRED", "정령 이름변경권 설정을 찾을 수 없습니다.", 409);
      }

      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
         VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, owner.identity_id]
      );
      const chickenQuantity = chicken.quantity - REQUIRED_CHICKEN;
      const ticketQuantity = (ticket.quantity ?? 0n) + 1n;
      const chickenUpdate = await transaction.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [chickenQuantity, owner.player_id, chicken.item_id, chicken.stack_version]
      );
      if (chickenUpdate.affectedRows !== 1n) {
        throw new ApplicationError("SPIRIT_NAME_COMBINE_CONFLICT", "인벤토리가 먼저 변경되었습니다.", 409);
      }
      if (ticket.stack_version === null) {
        await transaction.execute(
          "INSERT INTO inventory_stacks(player_id, item_id, quantity, version) VALUES (?, ?, 1, 1)",
          [owner.player_id, ticket.item_id]
        );
      } else {
        const ticketUpdate = await transaction.execute(
          "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
          [ticketQuantity, owner.player_id, ticket.item_id, ticket.stack_version]
        );
        if (ticketUpdate.affectedRows !== 1n) {
          throw new ApplicationError("SPIRIT_NAME_COMBINE_CONFLICT", "인벤토리가 먼저 변경되었습니다.", 409);
        }
      }
      await transaction.execute(
        `INSERT INTO inventory_ledger
          (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code)
         VALUES (?, 1, ?, ?, -100, 'spirit_name_combine_material'),
                (?, 2, ?, ?, 1, 'spirit_name_ticket_crafted')`,
        [operation.insertId, owner.player_id, chicken.item_id, operation.insertId, owner.player_id, ticket.item_id]
      );

      const rankedName = `${owner.rank_emoji ?? ""}${owner.current_display_name}`;
      const data = `[${rankedName}] 님\n정령 이름변경권📝 조합이 완료되었습니다`;
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
         VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
         VALUES (?, 'SPIRIT_NAME_COMBINE', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [command.eventId, operation.insertId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
         VALUES (?, 'external_identity', ?, 'player', ?, 'spirit.name_combine', 'success', 'Iris /정령이름조합', ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, owner.identity_id, owner.player_id, JSON.stringify({
          chickenQuantity: chickenQuantity.toString(), ticketQuantity: ticketQuantity.toString()
        })]
      );
      const result: SpiritNameCombineResult = {
        status: "crafted", playerId: owner.player_id.toString(),
        chickenQuantity: chickenQuantity.toString(), ticketQuantity: ticketQuantity.toString(),
        outboxId: outbox.insertId.toString(), data, auditId: audit.insertId.toString()
      };
      await transaction.execute(
        "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }
}
