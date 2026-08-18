import { createHash, randomUUID } from "node:crypto";
import { readAuthorization } from "../admin/auth-service.js";
import type { DatabaseClient } from "../database.js";
import type {
  BagAttributeItem,
  BagAttributeRepository,
  BagAttributeResult,
  ParsedBagAttributeCommand
} from "./bag-attribute.js";

interface TargetRow {
  player_id: bigint;
  current_display_name: string;
}

interface ItemRow {
  item_id: bigint;
  item_code: string;
  display_name: string;
  quantity: bigint;
  version: bigint;
  legacy_bag_order: string | null;
}

const INTIMACY_ITEM = /^펫 친밀도🐾\s*\[Lv\.\d+\]\(\d+\/1000\)\+\d+💕$/;
const KOREAN = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/;

// 긴 event ID를 operations의 idempotency 키 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 컬럼에서 재시도 결과를 복원합니다.
function parseStoredResult(value: string | BagAttributeResult): BagAttributeResult {
  return typeof value === "string" ? JSON.parse(value) as BagAttributeResult : value;
}

// 레거시 generateBagOutput과 같은 번호 순서로 조정 가능한 가방 항목을 정렬합니다.
export function sortLegacyBagAttributeItems(items: BagAttributeItem[]): BagAttributeItem[] {
  const intimacy = items.filter((item) => INTIMACY_ITEM.test(item.displayName));
  const special = items
    .filter((item) => !INTIMACY_ITEM.test(item.displayName) && item.legacyBagOrder !== null && item.quantity !== 0n)
    .sort((left, right) => left.legacyBagOrder! - right.legacyBagOrder!);
  const other = items
    .filter((item) => !INTIMACY_ITEM.test(item.displayName) && item.legacyBagOrder === null)
    .sort((left, right) => {
      const leftKorean = KOREAN.test(left.displayName);
      const rightKorean = KOREAN.test(right.displayName);
      if (leftKorean !== rightKorean) return leftKorean ? -1 : 1;
      return left.displayName < right.displayName ? -1 : left.displayName > right.displayName ? 1 : 0;
    });
  return [...intimacy, ...special, ...other];
}

// 관리자 권한 확인과 가방 절대 수량 변경·원장·감사·답장을 MariaDB에 저장합니다.
export class MariaBagAttributeRepository implements BagAttributeRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findAuthorizedOperator(externalUserId: string): Promise<string | null> {
    const rows = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id
         FROM external_identities identity
         JOIN admin_operator_external_identities mapping ON mapping.external_identity_id = identity.id
         JOIN admin_operators operator ON operator.id = mapping.operator_id
        WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
          AND identity.status = 'linked' AND operator.status = 'active'
        LIMIT 1`,
      [externalUserId]
    );
    const operatorId = rows[0]?.operator_id.toString();
    if (operatorId === undefined) return null;
    const authorization = await readAuthorization(this.database, operatorId);
    return authorization.permissions.includes("game.inventory.change") ? operatorId : null;
  }

  async adjust(input: {
    externalUserId: string;
    channelId: string;
    message: string;
    eventId: string;
    operatorId: string;
  } & ParsedBagAttributeCommand): Promise<BagAttributeResult> {
    const scope = `inventory.bag_attribute:${input.operatorId}`;
    const eventKey = normalizeEventKey(input.eventId);

    return this.database.withTransaction(async (transaction) => {
      const prior = await transaction.query<Array<{ result_json: string | BagAttributeResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
        return parseStoredResult(prior[0].result_json);
      }

      const targets = await transaction.query<TargetRow[]>(
        `SELECT player_id, current_display_name
           FROM player_profiles
          WHERE current_display_name = ?
          ORDER BY player_id
          LIMIT 2
          FOR UPDATE`,
        [input.targetName]
      );
      const target = targets[0];
      if (target === undefined) {
        return { status: "player_not_found", data: `${input.targetName}는(은) 존재하지 않는 사용자입니다.` };
      }

      const rows = await transaction.query<ItemRow[]>(
        `SELECT stack.item_id, item.code AS item_code, item.display_name, stack.quantity, stack.version,
                JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json, '$.legacyBagOrder')) AS legacy_bag_order
           FROM inventory_stacks stack
           JOIN item_definitions item ON item.id = stack.item_id
          WHERE stack.player_id = ? AND item.active = TRUE AND item.stackable = TRUE
          FOR UPDATE`,
        [target.player_id]
      );
      const items = sortLegacyBagAttributeItems(rows.map((row) => ({
        itemId: row.item_id,
        itemCode: row.item_code,
        displayName: row.display_name,
        quantity: row.quantity,
        version: row.version,
        legacyBagOrder: row.legacy_bag_order === null ? null : Number(row.legacy_bag_order)
      })));
      if (input.itemNumber <= 0 || input.itemNumber > items.length) {
        return { status: "invalid_item_number", data: "유효한 아이템 번호를 입력해주세요." };
      }

      const item = items[input.itemNumber - 1]!;
      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
         VALUES (?, ?, ?, 'admin_operator', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, input.operatorId]
      );
      const quantityDelta = input.itemCount - item.quantity;
      const update = input.itemCount === 0n
        ? await transaction.execute(
          "DELETE FROM inventory_stacks WHERE player_id = ? AND item_id = ? AND version = ?",
          [target.player_id, item.itemId, item.version]
        )
        : await transaction.execute(
          "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
          [input.itemCount, target.player_id, item.itemId, item.version]
        );
      if (update.affectedRows !== 1n) throw new Error("Bag attribute inventory version conflict.");

      await transaction.execute(
        `INSERT INTO inventory_ledger
          (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code)
         VALUES (?, 1, ?, ?, ?, 'legacy_bag_attribute')`,
        [operation.insertId, target.player_id, item.itemId, quantityDelta]
      );
      const deleted = input.itemCount === 0n;
      const data = deleted
        ? `[${target.current_display_name}] 님의 가방에서 ${item.displayName}이(가) 삭제되었습니다.`
        : `[${target.current_display_name}] 님의 가방에서 ${item.displayName}의 수량이 ${input.itemCount}개로 변경되었습니다.`;
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
         VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [operation.insertId, input.channelId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
         VALUES (?, 'bag_attribute', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [input.eventId, operation.insertId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
         VALUES (?, 'admin_operator', ?, 'player', ?, 'inventory.bag_attribute', 'success', 'Iris /가방속성', ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, target.player_id, JSON.stringify({
          itemCode: item.itemCode,
          previousQuantity: item.quantity.toString(),
          quantity: input.itemCount.toString(),
          quantityDelta: quantityDelta.toString()
        })]
      );
      const result: BagAttributeResult = {
        status: deleted ? "deleted" : "changed",
        data,
        playerId: target.player_id.toString(),
        itemCode: item.itemCode,
        itemName: item.displayName,
        quantity: input.itemCount.toString(),
        quantityDelta: quantityDelta.toString(),
        outboxId: outbox.insertId.toString(),
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
