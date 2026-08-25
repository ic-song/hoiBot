import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const ATTACK_TICKET_CODE = "legacy-territory-surprise-attack-ticket";
const DEFENSE_TICKET_CODE = "legacy-territory-absolute-defense-ticket";
const MAX_GRANT_QUANTITY = 1000000n;

export interface TerritoryProtectionGrantCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface TerritoryProtectionGrantResult {
  status: "granted";
  targetPlayerId: string;
  targetName: string;
  grantQuantity: string;
  attackTicketQuantity: string;
  defenseTicketQuantity: string;
  outboxId: string;
  auditId: string;
  data: string;
  replayed?: boolean;
}

interface ParsedGrantCommand { quantity: bigint; targetName: string; }

// `/공방, 대상` 또는 `/공방N, 대상` 전체 형식만 실행 대상으로 인정합니다.
export function isTerritoryProtectionGrantCommand(message: string | undefined): boolean {
  return message !== undefined && /^\/공방\d*,\s*\S(?:.*\S)?$/.test(message);
}

// 지급 수량과 대상 표시명을 안전한 범위로 해석합니다.
function parseGrantCommand(message: string): ParsedGrantCommand {
  const matched = /^\/공방(\d*)?,\s*(\S(?:.*\S)?)$/.exec(message);
  if (matched === null) throw new ApplicationError("INVALID_TERRITORY_PROTECTION_GRANT_COMMAND", "정확한 /공방[수량], [대상]을 입력해주세요.", 422);
  const quantity = matched[1] === undefined || matched[1] === "" ? 1n : BigInt(matched[1]);
  if (quantity < 1n || quantity > MAX_GRANT_QUANTITY) {
    throw new ApplicationError("TERRITORY_PROTECTION_GRANT_LIMIT", "공방권 지급 수량은 1~1,000,000개만 가능합니다.", 422);
  }
  return { quantity, targetName: matched[2]! };
}

// 긴 event ID를 operations 멱등키 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function parseStoredResult(value: string | TerritoryProtectionGrantResult): TerritoryProtectionGrantResult {
  const result = typeof value === "string" ? JSON.parse(value) as TerritoryProtectionGrantResult : value;
  return { ...result, replayed: true };
}

// 최고관리자의 두 영지 공방권 지급과 원장·감사·응답을 한 트랜잭션으로 저장합니다.
export class TerritoryProtectionGrantService {
  constructor(private readonly database: DatabaseClient) {}

  async execute(command: TerritoryProtectionGrantCommand): Promise<TerritoryProtectionGrantResult> {
    if (!isTerritoryProtectionGrantCommand(command.message)) {
      throw new ApplicationError("INVALID_TERRITORY_PROTECTION_GRANT_COMMAND", "정확한 /공방[수량], [대상]을 입력해주세요.", 422);
    }
    const parsed = parseGrantCommand(command.message);
    return this.database.withTransaction(async (transaction) => {
      const operators = await transaction.query<Array<{ operator_id: bigint }>>(
        `SELECT mapping.operator_id
         FROM external_identities identity
         JOIN admin_operator_external_identities mapping ON mapping.external_identity_id = identity.id
         JOIN admin_operators operator ON operator.id = mapping.operator_id
         JOIN admin_operator_roles operator_role ON operator_role.operator_id = operator.id
         JOIN admin_role_permissions permission ON permission.role_id = operator_role.role_id
         WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
           AND identity.status = 'linked' AND operator.status = 'active'
           AND permission.permission_code = 'territory.protection.grant' LIMIT 1 FOR UPDATE`,
        [command.externalUserId]
      );
      const operator = operators[0];
      if (operator === undefined) throw new ApplicationError("FORBIDDEN", "공방권 지급 권한이 없습니다.", 403);

      const scope = `admin.territory-protection-grant:${operator.operator_id}`;
      const eventKey = normalizeEventKey(command.eventId);
      const prior = await transaction.query<Array<{ result_json: string | TerritoryProtectionGrantResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const targets = await transaction.query<Array<{ player_id: bigint }>>(
        "SELECT player_id FROM player_profiles WHERE current_display_name = ? ORDER BY player_id LIMIT 2 FOR UPDATE",
        [parsed.targetName]
      );
      if (targets.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", `❌ [${parsed.targetName}] 님은 존재하지 않습니다.`, 404);
      if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 player ID로 지급해야 합니다.", 409);
      const target = targets[0]!;

      const items = await transaction.query<Array<{ id: bigint; code: string }>>(
        "SELECT id, code FROM item_definitions WHERE code IN (?, ?) AND active = TRUE AND stackable = TRUE ORDER BY code",
        [ATTACK_TICKET_CODE, DEFENSE_TICKET_CODE]
      );
      const attackItem = items.find((item) => item.code === ATTACK_TICKET_CODE);
      const defenseItem = items.find((item) => item.code === DEFENSE_TICKET_CODE);
      if (attackItem === undefined || defenseItem === undefined) throw new ApplicationError("TERRITORY_PROTECTION_ITEM_REQUIRED", "공방권 아이템 설정을 찾을 수 없습니다.", 409);
      await transaction.execute(
        "INSERT IGNORE INTO inventory_stacks(player_id, item_id, quantity, version) VALUES (?, ?, 0, 1), (?, ?, 0, 1)",
        [target.player_id, attackItem.id, target.player_id, defenseItem.id]
      );
      const stacks = await transaction.query<Array<{ item_id: bigint; code: string; quantity: bigint; version: bigint }>>(
        `SELECT stack.item_id, item.code, stack.quantity, stack.version
         FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
         WHERE stack.player_id = ? AND item.code IN (?, ?) ORDER BY item.code FOR UPDATE`,
        [target.player_id, ATTACK_TICKET_CODE, DEFENSE_TICKET_CODE]
      );
      const attackStack = stacks.find((stack) => stack.code === ATTACK_TICKET_CODE)!;
      const defenseStack = stacks.find((stack) => stack.code === DEFENSE_TICKET_CODE)!;

      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
         VALUES (?, ?, ?, 'admin_operator', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, operator.operator_id]
      );
      const attackQuantity = attackStack.quantity + parsed.quantity;
      const defenseQuantity = defenseStack.quantity + parsed.quantity;
      const attackUpdate = await transaction.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [attackQuantity, target.player_id, attackStack.item_id, attackStack.version]
      );
      const defenseUpdate = await transaction.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [defenseQuantity, target.player_id, defenseStack.item_id, defenseStack.version]
      );
      if (attackUpdate.affectedRows !== 1n || defenseUpdate.affectedRows !== 1n) {
        throw new ApplicationError("TERRITORY_PROTECTION_GRANT_CONFLICT", "대상의 가방 정보가 먼저 변경되었습니다.", 409);
      }
      await transaction.execute(
        `INSERT INTO inventory_ledger
          (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code)
         VALUES (?, 1, ?, ?, ?, 'admin_territory_attack_ticket_grant'),
                (?, 2, ?, ?, ?, 'admin_territory_defense_ticket_grant')`,
        [operation.insertId, target.player_id, attackStack.item_id, parsed.quantity,
          operation.insertId, target.player_id, defenseStack.item_id, parsed.quantity]
      );

      const data = `✅ [${parsed.targetName}] 님에게 영지 공방권을 ${parsed.quantity}개씩 지급했습니다.`;
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
         VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
         VALUES (?, 'admin_territory_protection_grant', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [command.eventId, operation.insertId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
         VALUES (?, 'admin_operator', ?, 'player', ?, 'territory.protection.grant', 'success', 'Iris /공방', ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, operator.operator_id, target.player_id, JSON.stringify({
          targetName: parsed.targetName, grantQuantity: parsed.quantity.toString(),
          attackTicketQuantity: attackQuantity.toString(), defenseTicketQuantity: defenseQuantity.toString()
        })]
      );
      const result: TerritoryProtectionGrantResult = {
        status: "granted", targetPlayerId: target.player_id.toString(), targetName: parsed.targetName,
        grantQuantity: parsed.quantity.toString(), attackTicketQuantity: attackQuantity.toString(),
        defenseTicketQuantity: defenseQuantity.toString(), outboxId: outbox.insertId.toString(),
        auditId: audit.insertId.toString(), data
      };
      await transaction.execute(
        "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }
}
