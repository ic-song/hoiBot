import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const CHICKEN_ITEM_CODE = "legacy-seasoned-chicken";
const RESET_TICKET_ITEM_CODE = "legacy-castle-battle-reset-ticket";
const CHICKEN_PER_TICKET = 6n;

export interface CastleBattleResetCraftCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface CastleBattleResetCraftResult {
  status: "crafted" | "blocked_by_castle_siege";
  playerId?: string;
  craftQuantity?: string;
  chickenQuantity?: string;
  ticketQuantity?: string;
  outboxId?: string;
  data?: string;
  auditId?: string;
}

interface CraftOwnerRow {
  identity_id: bigint;
  player_id: bigint;
}

// 인자 없는 명령과 숫자 수량 하나만 허용합니다.
export function isCastleBattleResetCraftCommand(message: string | undefined): boolean {
  return message === "/캐슬대전조합" || (message !== undefined && /^\/캐슬대전조합\s+\d+$/.test(message));
}

// legacy 기본 수량 1과 숫자 인자를 bigint로 복원합니다.
function parseCraftQuantity(message: string): bigint {
  if (message === "/캐슬대전조합") return 1n;
  const raw = message.trim().split(/\s+/)[1];
  if (raw === undefined) throw new ApplicationError("INVALID_CASTLE_BATTLE_RESET_CRAFT_COMMAND", "정확한 /캐슬대전조합 [수량]을 입력해주세요.", 422);
  const quantity = BigInt(raw);
  if (quantity > 1000000n) throw new ApplicationError("CASTLE_BATTLE_RESET_CRAFT_LIMIT", "한 번에 조합할 수 있는 수량을 초과했습니다.", 422);
  return quantity;
}

// 긴 event ID를 operations idempotency 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 컬럼에서 재시도 결과를 복원합니다.
function parseStoredResult(value: string | CastleBattleResetCraftResult): CastleBattleResetCraftResult {
  return typeof value === "string" ? JSON.parse(value) as CastleBattleResetCraftResult : value;
}

// 양념치킨 차감과 캐슬대전 리셋권 지급을 원장과 함께 원자적으로 저장합니다.
export class CastleBattleResetCraftService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: CastleBattleResetCraftCommand): Promise<CastleBattleResetCraftResult> {
    if (!isCastleBattleResetCraftCommand(command.message)) {
      throw new ApplicationError("INVALID_CASTLE_BATTLE_RESET_CRAFT_COMMAND", "정확한 /캐슬대전조합 [수량]을 입력해주세요.", 422);
    }
    const craftQuantity = parseCraftQuantity(command.message);
    const requiredChicken = CHICKEN_PER_TICKET * craftQuantity;

    return this.database.withTransaction(async (transaction) => {
      const activeSieges = await transaction.query<Array<{ active_count: bigint }>>(
        `SELECT COUNT(*) AS active_count FROM castle_battle_seasons
         WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3))
           AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))`
      );
      if ((activeSieges[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege" };

      const owners = await transaction.query<CraftOwnerRow[]>(
        `SELECT identity.id AS identity_id, identity.player_id
         FROM external_identities identity
         WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
           AND identity.status = 'linked' AND identity.player_id IS NOT NULL
         FOR UPDATE`,
        [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);

      const scope = `castle.battle-reset.craft:${owner.identity_id}`;
      const eventKey = normalizeEventKey(command.eventId);
      const prior = await transaction.query<Array<{ result_json: string | CastleBattleResetCraftResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const stacks = await transaction.query<Array<{ item_id: bigint; code: string; quantity: bigint; version: bigint }>>(
        `SELECT stack.item_id, item.code, stack.quantity, stack.version
         FROM item_definitions item
         JOIN inventory_stacks stack ON stack.item_id = item.id AND stack.player_id = ?
         WHERE item.code IN (?, ?) AND item.active = TRUE AND item.stackable = TRUE
         ORDER BY item.code FOR UPDATE`,
        [owner.player_id, CHICKEN_ITEM_CODE, RESET_TICKET_ITEM_CODE]
      );
      const chicken = stacks.find((row) => row.code === CHICKEN_ITEM_CODE);
      const ticket = stacks.find((row) => row.code === RESET_TICKET_ITEM_CODE);
      if (chicken === undefined || chicken.quantity < requiredChicken) {
        throw new ApplicationError("SEASONED_CHICKEN_REQUIRED", `양념치킨🐔 ${requiredChicken}마리가 필요해요!`, 409);
      }
      if (ticket === undefined) throw new ApplicationError("CASTLE_BATTLE_RESET_TICKET_ITEM_REQUIRED", "캐슬대전리셋권 설정을 찾을 수 없습니다.", 409);

      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
         VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, owner.identity_id]
      );
      const chickenQuantity = chicken.quantity - requiredChicken;
      const ticketQuantity = ticket.quantity + craftQuantity;
      const chickenUpdate = await transaction.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [chickenQuantity, owner.player_id, chicken.item_id, chicken.version]
      );
      const ticketUpdate = await transaction.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [ticketQuantity, owner.player_id, ticket.item_id, ticket.version]
      );
      if (chickenUpdate.affectedRows !== 1n || ticketUpdate.affectedRows !== 1n) {
        throw new ApplicationError("CASTLE_BATTLE_RESET_CRAFT_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
      }
      await transaction.execute(
        `INSERT INTO inventory_ledger
          (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code)
         VALUES (?, 1, ?, ?, ?, 'castle_battle_reset_craft_material'),
                (?, 2, ?, ?, ?, 'castle_battle_reset_ticket_crafted')`,
        [operation.insertId, owner.player_id, chicken.item_id, (-requiredChicken).toString(),
          operation.insertId, owner.player_id, ticket.item_id, craftQuantity.toString()]
      );

      const data = `캐슬대전리셋권🐶 ${craftQuantity}개가 완성되었습니다!\n/캐슬대전 으로 대전에 참여하세요!`;
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
         VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
         VALUES (?, 'castle_battle_reset_craft', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [command.eventId, operation.insertId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
         VALUES (?, 'external_identity', ?, 'player', ?, 'castle.battle_reset.craft', 'success', 'Iris /캐슬대전조합', ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, owner.identity_id, owner.player_id, JSON.stringify({
          craftQuantity: craftQuantity.toString(), chickenQuantity: chickenQuantity.toString(), ticketQuantity: ticketQuantity.toString()
        })]
      );
      const result: CastleBattleResetCraftResult = {
        status: "crafted", playerId: owner.player_id.toString(), craftQuantity: craftQuantity.toString(),
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
