import { createHash, randomUUID } from "node:crypto";
import { readAuthorization } from "../admin/auth-service.js";
import type { DatabaseClient } from "../database.js";
import type { BagAddRepository, BagAddResult, ParsedBagAddCommand } from "./bag-add.js";

function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

function legacyItemCode(itemName: string): string {
  return `bag_${createHash("sha256").update(itemName).digest("hex").slice(0, 16)}`;
}

function parseStoredResult(value: string | BagAddResult): BagAddResult {
  return typeof value === "string" ? JSON.parse(value) as BagAddResult : value;
}

// `/가방추가`의 catalog 생성·수량 누적·원장·감사·답장을 한 트랜잭션으로 저장합니다.
export class MariaBagAddRepository implements BagAddRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findAuthorizedOperator(externalUserId: string): Promise<string | null> {
    const rows = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id
         FROM external_identities identity
         JOIN admin_operator_external_identities mapping ON mapping.external_identity_id = identity.id
         JOIN admin_operators operator ON operator.id = mapping.operator_id
        WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
          AND identity.status = 'linked' AND operator.status = 'active' LIMIT 1`,
      [externalUserId]
    );
    const operatorId = rows[0]?.operator_id.toString();
    if (operatorId === undefined) return null;
    const authorization = await readAuthorization(this.database, operatorId);
    return authorization.permissions.includes("game.inventory.change") ? operatorId : null;
  }

  async add(input: BagAddInputInternal): Promise<BagAddResult> {
    const scope = `inventory.bag_add:${input.operatorId}`;
    const eventKey = normalizeEventKey(input.eventId);
    return this.database.withTransaction(async (transaction) => {
      const prior = await transaction.query<Array<{ result_json: string | BagAddResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const targets = await transaction.query<Array<{ player_id: bigint; current_display_name: string }>>(
        "SELECT player_id, current_display_name FROM player_profiles WHERE current_display_name = ? ORDER BY player_id LIMIT 2 FOR UPDATE",
        [input.targetName]
      );
      const target = targets[0];
      if (target === undefined) return { status: "player_not_found", data: `${input.targetName}는(은) 존재하지 않는 사용자입니다.` };

      const code = legacyItemCode(input.itemName);
      let definitions = await transaction.query<Array<{ id: bigint; code: string }>>(
        `SELECT id, code FROM item_definitions
          WHERE display_name = ? AND active = TRUE AND stackable = TRUE
          ORDER BY (code = ?) DESC, id LIMIT 2 FOR UPDATE`,
        [input.itemName, code]
      );
      if (definitions[0] === undefined) {
        await transaction.execute(
          `INSERT INTO item_definitions (code, display_name, asset_type_code, stackable, metadata_json, active, version)
           VALUES (?, ?, 'legacy_bag_item', TRUE, JSON_OBJECT('legacyImported', TRUE), TRUE, 1)
           ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), active = TRUE`,
          [code, input.itemName]
        );
        definitions = await transaction.query<Array<{ id: bigint; code: string }>>(
          "SELECT id, code FROM item_definitions WHERE code = ? AND stackable = TRUE FOR UPDATE",
          [code]
        );
      }
      const item = definitions[0]!;
      await transaction.execute(
        "INSERT IGNORE INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, 0, 0)",
        [target.player_id, item.id]
      );
      const stacks = await transaction.query<Array<{ quantity: bigint; version: bigint }>>(
        "SELECT quantity, version FROM inventory_stacks WHERE player_id = ? AND item_id = ? FOR UPDATE",
        [target.player_id, item.id]
      );
      const stack = stacks[0]!;
      const quantity = stack.quantity + input.itemCount;
      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
         VALUES (?, ?, ?, 'admin_operator', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, input.operatorId]
      );
      const update = await transaction.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [quantity, target.player_id, item.id, stack.version]
      );
      if (update.affectedRows !== 1n) throw new Error("Bag add inventory version conflict.");
      await transaction.execute(
        `INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code)
         VALUES (?, 1, ?, ?, ?, 'legacy_bag_add')`,
        [operation.insertId, target.player_id, item.id, input.itemCount]
      );
      const data = `${target.current_display_name}님의 가방에 ${input.itemName}을(를) ${input.itemCount}개 추가했습니다.`;
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
         VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [operation.insertId, input.channelId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
         VALUES (?, 'bag_add', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [input.eventId, operation.insertId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
         VALUES (?, 'admin_operator', ?, 'player', ?, 'inventory.bag_add', 'success', 'Iris /가방추가', ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, target.player_id, JSON.stringify({
          itemCode: item.code, previousQuantity: stack.quantity.toString(), quantity: quantity.toString(), quantityDelta: input.itemCount.toString()
        })]
      );
      const result: BagAddResult = {
        status: "added", data, playerId: target.player_id.toString(), itemCode: item.code,
        itemName: input.itemName, quantity: quantity.toString(), quantityDelta: input.itemCount.toString(),
        outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString()
      };
      await transaction.execute(
        "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }
}

type BagAddInputInternal = {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
  operatorId: string;
} & ParsedBagAddCommand;
