import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const MAX_GRANT_QUANTITY = 1000000n;
const GRANT_ITEMS = {
  "공헌": { itemCode: "guild_contribution_medal", displayName: "길드공헌훈장🌟(/길드공헌 숫자)" },
  "귀속": { itemCode: "mini_pet_unbind_ticket", displayName: "미니펫귀속해제권🐰(/귀속해제)" },
  "근당": { itemCode: "legacy_carrot_item", displayName: "🥕당근이세요?" },
  "땅": { itemCode: "land_document", displayName: "땅문서📜" },
  "미니엘리트": { itemCode: "package_mini_pet_elite_guaranteed", displayName: "미니펫🐹엘리트확정패키지(/미니펫엘리트오픈)" },
  "야구": { itemCode: "hoi_baseball_package", displayName: "호이베이스볼⚾️(/투수던집니다)" },
  "주간": { itemCode: "weekly_box", displayName: "주간상자🌼" },
  "지갑": { itemCode: "hoi_wallet", displayName: "호이지갑👛(/지갑털기)" },
  "태초": { itemCode: "bag_yakitori_package_10", displayName: "태초야키토리 10세트🥩(/이랏싸이마쎄)" }
} as const;

type GrantCommandName = keyof typeof GRANT_ITEMS;
interface ParsedGrantCommand { commandName: GrantCommandName; quantity: bigint; targetName: string; }

export interface FixedItemGrantCommand { externalUserId: string; channelId: string; message: string; eventId: string; }
export interface FixedItemGrantResult {
  status: "granted"; commandName: GrantCommandName; targetPlayerId: string; targetName: string;
  itemCode: string; itemDisplayName: string; grantQuantity: string; itemQuantity: string;
  outboxId: string; auditId: string; data: string; replayed?: boolean;
}

// 아홉 관리자 지급 명령의 완전한 쉼표 형식만 실행 대상으로 인정합니다.
export function isFixedItemGrantCommand(message: string | undefined): boolean {
  return message !== undefined && /^\/(?:공헌|귀속|근당|땅|미니엘리트|야구|주간|지갑|태초)\d*,\s*\S(?:.*\S)?$/.test(message);
}

// 명령별 stable item과 안전한 지급 수량·대상을 해석합니다.
function parseGrantCommand(message: string): ParsedGrantCommand {
  const matched = /^\/(공헌|귀속|근당|땅|미니엘리트|야구|주간|지갑|태초)(\d*)?,\s*(\S(?:.*\S)?)$/.exec(message);
  if (matched === null) throw new ApplicationError("INVALID_FIXED_ITEM_GRANT_COMMAND", "정확한 /지급명령[수량], [대상]을 입력해주세요.", 422);
  const commandName = matched[1] as GrantCommandName;
  const quantity = matched[2] === undefined || matched[2] === "" ? 1n : BigInt(matched[2]);
  if (quantity < 1n || quantity > MAX_GRANT_QUANTITY) throw new ApplicationError("FIXED_ITEM_GRANT_LIMIT", "아이템 지급 수량은 1~1,000,000개만 가능합니다.", 422);
  return { commandName, quantity, targetName: matched[3]! };
}

// 긴 event ID를 operations 멱등키 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function parseStoredResult(value: string | FixedItemGrantResult): FixedItemGrantResult {
  const result = typeof value === "string" ? JSON.parse(value) as FixedItemGrantResult : value;
  return { ...result, replayed: true };
}

// 관리자 고정 아이템 지급과 inventory ledger·감사·응답을 한 트랜잭션으로 저장합니다.
export class FixedItemGrantService {
  constructor(private readonly database: DatabaseClient) {}

  async execute(command: FixedItemGrantCommand): Promise<FixedItemGrantResult> {
    if (!isFixedItemGrantCommand(command.message)) throw new ApplicationError("INVALID_FIXED_ITEM_GRANT_COMMAND", "정확한 /지급명령[수량], [대상]을 입력해주세요.", 422);
    const parsed = parseGrantCommand(command.message);
    const configuredItem = GRANT_ITEMS[parsed.commandName];
    return this.database.withTransaction(async (transaction) => {
      const operators = await transaction.query<Array<{ operator_id: bigint }>>(
        `SELECT mapping.operator_id FROM external_identities identity
         JOIN admin_operator_external_identities mapping ON mapping.external_identity_id = identity.id
         JOIN admin_operators operator ON operator.id = mapping.operator_id
         JOIN admin_operator_roles operator_role ON operator_role.operator_id = operator.id
         JOIN admin_role_permissions permission ON permission.role_id = operator_role.role_id
         WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked'
           AND operator.status = 'active' AND permission.permission_code = 'inventory.fixed-item.grant' LIMIT 1 FOR UPDATE`,
        [command.externalUserId]
      );
      const operator = operators[0];
      if (operator === undefined) throw new ApplicationError("FORBIDDEN", "고정 아이템 지급 권한이 없습니다.", 403);

      const scope = `admin.fixed-item-grant:${operator.operator_id}`;
      const eventKey = normalizeEventKey(command.eventId);
      const prior = await transaction.query<Array<{ result_json: string | FixedItemGrantResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE", [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const targets = await transaction.query<Array<{ player_id: bigint }>>(
        "SELECT player_id FROM player_profiles WHERE current_display_name = ? ORDER BY player_id LIMIT 2 FOR UPDATE", [parsed.targetName]
      );
      if (targets.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", `❌ [${parsed.targetName}] 님은 존재하지 않습니다.`, 404);
      if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 player ID로 지급해야 합니다.", 409);
      const target = targets[0]!;
      const items = await transaction.query<Array<{ id: bigint; display_name: string }>>(
        "SELECT id, display_name FROM item_definitions WHERE code = ? AND active = TRUE AND stackable = TRUE", [configuredItem.itemCode]
      );
      const item = items[0];
      if (item === undefined || item.display_name !== configuredItem.displayName) throw new ApplicationError("FIXED_ITEM_DEFINITION_REQUIRED", "지급 아이템 설정을 찾을 수 없습니다.", 409);
      await transaction.execute("INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES(?,?,0,1)", [target.player_id, item.id]);
      const stacks = await transaction.query<Array<{ quantity: bigint; version: bigint }>>(
        "SELECT quantity,version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [target.player_id, item.id]
      );
      const stack = stacks[0]!;
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES(?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, operator.operator_id]
      );
      const itemQuantity = stack.quantity + parsed.quantity;
      const updated = await transaction.execute(
        "UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",
        [itemQuantity, target.player_id, item.id, stack.version]
      );
      if (updated.affectedRows !== 1n) throw new ApplicationError("FIXED_ITEM_GRANT_CONFLICT", "대상의 가방 정보가 먼저 변경되었습니다.", 409);
      await transaction.execute(
        "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES(?,1,?,?,?,'admin_fixed_item_grant')",
        [operation.insertId, target.player_id, item.id, parsed.quantity]
      );
      const data = `✅ [${parsed.targetName}] 님에게 ${configuredItem.displayName} ${parsed.quantity}개를 지급했습니다.`;
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES(?,'admin_fixed_item_grant',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, [command.eventId, operation.insertId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES(?,'admin_operator',?,'player',?,'inventory.fixed-item.grant','success',?, ?,UTC_TIMESTAMP(3))`,
        [operation.insertId, operator.operator_id, target.player_id, `Iris /${parsed.commandName}`, JSON.stringify({ commandName: parsed.commandName, itemCode: configuredItem.itemCode, grantQuantity: parsed.quantity.toString(), itemQuantity: itemQuantity.toString() })]
      );
      const result: FixedItemGrantResult = { status: "granted", commandName: parsed.commandName, targetPlayerId: target.player_id.toString(), targetName: parsed.targetName,
        itemCode: configuredItem.itemCode, itemDisplayName: configuredItem.displayName, grantQuantity: parsed.quantity.toString(), itemQuantity: itemQuantity.toString(),
        outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(), data };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
