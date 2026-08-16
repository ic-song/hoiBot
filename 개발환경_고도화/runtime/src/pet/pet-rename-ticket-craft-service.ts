import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const JUNK_ITEM_CODE = "legacy-junk-item";
const PET_RENAME_TICKET_CODE = "legacy-pet-name-change-ticket";
const REQUIRED_JUNK = 10n;
const REQUIRED_POINT = 100000000n;

export interface PetRenameTicketCraftCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface PetRenameTicketCraftResult {
  status: "crafted" | "blocked_by_castle_siege";
  playerId?: string;
  junkQuantity?: string;
  pointBalance?: string;
  ticketQuantity?: string;
  outboxId?: string;
  data?: string;
  auditId?: string;
}

interface CraftOwnerRow {
  identity_id: bigint;
  player_id: bigint;
  current_display_name: string;
  tier_code: string | null;
}

// `/펫이름조합` exact 명령만 실제 변경 후보로 허용합니다.
export function isPetRenameTicketCraftCommand(message: string | undefined): boolean {
  return message === "/펫이름조합";
}

// 긴 event ID를 operations의 idempotency 키 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 컬럼에서 재시도 결과를 복원합니다.
function parseStoredResult(value: string | PetRenameTicketCraftResult): PetRenameTicketCraftResult {
  return typeof value === "string" ? JSON.parse(value) as PetRenameTicketCraftResult : value;
}

// 신규·기본 티어의 기존 새싹 표시를 보존합니다.
function rankedName(owner: CraftOwnerRow): string {
  return `${owner.tier_code === "seedling" || owner.tier_code === "starter" ? "🌱" : ""}${owner.current_display_name}`;
}

// 정수 DECIMAL 문자열을 손실 없는 bigint로 변환합니다.
function decimalInteger(value: string): bigint {
  const match = /^(-?\d+)(?:\.0+)?$/.exec(value);
  if (match === null) throw new ApplicationError("NON_INTEGER_POINT_BALANCE", "포인트 잔액을 정수로 확인할 수 없습니다.", 409);
  return BigInt(match[1]!);
}

// 잡템·포인트 차감과 변경권 지급·두 원장·감사·답장을 한 트랜잭션으로 저장합니다.
export class PetRenameTicketCraftService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: PetRenameTicketCraftCommand): Promise<PetRenameTicketCraftResult> {
    if (!isPetRenameTicketCraftCommand(command.message)) {
      throw new ApplicationError("INVALID_PET_RENAME_TICKET_CRAFT_COMMAND", "정확히 /펫이름조합을 입력해주세요.", 422);
    }

    return this.database.withTransaction(async (transaction) => {
      const activeSieges = await transaction.query<Array<{ active_count: bigint }>>(
        `SELECT COUNT(*) AS active_count FROM castle_battle_seasons
         WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3))
           AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))`
      );
      if ((activeSieges[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege" };

      const owners = await transaction.query<CraftOwnerRow[]>(
        `SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name, profile.tier_code
         FROM external_identities identity
         JOIN player_profiles profile ON profile.player_id = identity.player_id
         WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
           AND identity.status = 'linked' AND identity.player_id IS NOT NULL
         FOR UPDATE`,
        [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);

      const scope = `pet.rename-ticket.craft:${owner.identity_id}`;
      const eventKey = normalizeEventKey(command.eventId);
      const prior = await transaction.query<Array<{ result_json: string | PetRenameTicketCraftResult | null }>>(
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
        [owner.player_id, JUNK_ITEM_CODE, PET_RENAME_TICKET_CODE]
      );
      const junk = stacks.find((row) => row.code === JUNK_ITEM_CODE);
      const ticket = stacks.find((row) => row.code === PET_RENAME_TICKET_CODE);
      if (junk === undefined || junk.quantity < REQUIRED_JUNK) {
        throw new ApplicationError("JUNK_ITEM_REQUIRED", "잡템☠️ 10개가 필요해요!", 409);
      }
      if (ticket === undefined) throw new ApplicationError("PET_RENAME_TICKET_ITEM_REQUIRED", "펫 이름변경권 설정을 찾을 수 없습니다.", 409);

      const accounts = await transaction.query<Array<{ balance: string; version: bigint }>>(
        "SELECT CAST(balance AS CHAR) AS balance, version FROM currency_accounts WHERE player_id = ? AND currency_code = 'point' FOR UPDATE",
        [owner.player_id]
      );
      const account = accounts[0];
      const pointBalance = account === undefined ? 0n : decimalInteger(account.balance);
      if (account === undefined || pointBalance < REQUIRED_POINT) {
        throw new ApplicationError("POINT_REQUIRED", "🅟100,000,000 가 필요해요!", 409);
      }

      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
         VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, owner.identity_id]
      );
      const junkQuantity = junk.quantity - REQUIRED_JUNK;
      const ticketQuantity = ticket.quantity + 1n;
      const remainingPoint = pointBalance - REQUIRED_POINT;
      const junkUpdate = await transaction.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [junkQuantity, owner.player_id, junk.item_id, junk.version]
      );
      const ticketUpdate = await transaction.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [ticketQuantity, owner.player_id, ticket.item_id, ticket.version]
      );
      const pointUpdate = await transaction.execute(
        "UPDATE currency_accounts SET balance = ?, version = version + 1 WHERE player_id = ? AND currency_code = 'point' AND version = ?",
        [remainingPoint.toString(), owner.player_id, account.version]
      );
      if (junkUpdate.affectedRows !== 1n || ticketUpdate.affectedRows !== 1n || pointUpdate.affectedRows !== 1n) {
        throw new ApplicationError("PET_RENAME_TICKET_CRAFT_CONFLICT", "재화 정보가 먼저 변경되었습니다.", 409);
      }
      await transaction.execute(
        `INSERT INTO inventory_ledger
          (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code)
         VALUES (?, 1, ?, ?, -10, 'pet_rename_ticket_craft_material'),
                (?, 2, ?, ?, 1, 'pet_rename_ticket_crafted')`,
        [operation.insertId, owner.player_id, junk.item_id, operation.insertId, owner.player_id, ticket.item_id]
      );
      await transaction.execute(
        `INSERT INTO currency_ledger
          (operation_id, sequence_no, player_id, currency_code, delta, balance_after, reason_code)
         VALUES (?, 1, ?, 'point', -100000000, ?, 'pet_rename_ticket_craft_cost')`,
        [operation.insertId, owner.player_id, remainingPoint.toString()]
      );

      const data = `행복주민센터에서 [${rankedName(owner)}] 님께\n펫 이름변경권🎫을 주었습니다.\n사용법: /펫이름 [변경할이름(6자)]`;
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
         VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
         VALUES (?, 'pet_rename_ticket_craft', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [command.eventId, operation.insertId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
         VALUES (?, 'external_identity', ?, 'player', ?, 'pet.rename_ticket.craft', 'success', 'Iris /펫이름조합', ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, owner.identity_id, owner.player_id, JSON.stringify({
          junkQuantity: junkQuantity.toString(), pointBalance: remainingPoint.toString(), ticketQuantity: ticketQuantity.toString()
        })]
      );
      const result: PetRenameTicketCraftResult = {
        status: "crafted", playerId: owner.player_id.toString(), junkQuantity: junkQuantity.toString(),
        pointBalance: remainingPoint.toString(), ticketQuantity: ticketQuantity.toString(),
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
