import { createHash, randomUUID } from "node:crypto";
import { readAuthorization } from "../admin/auth-service.js";
import type { DatabaseClient } from "../database.js";
import type { InventorySnapshotRepository, InventorySnapshotResult } from "./inventory-snapshot.js";

function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

function parseStoredResult(value: string | InventorySnapshotResult): InventorySnapshotResult {
  return typeof value === "string" ? JSON.parse(value) as InventorySnapshotResult : value;
}

// 전체 stack을 잠근 동일 시점 기준으로 DB 스냅샷·감사·답장을 저장합니다.
export class MariaInventorySnapshotRepository implements InventorySnapshotRepository {
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

  async save(input: InventorySnapshotInternalInput): Promise<InventorySnapshotResult> {
    const scope = `inventory.snapshot:${input.operatorId}`;
    const eventKey = normalizeEventKey(input.eventId);
    return this.database.withTransaction(async (transaction) => {
      const prior = await transaction.query<Array<{ result_json: string | InventorySnapshotResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const rows = await transaction.query<Array<{ player_id: bigint; item_id: bigint; quantity: bigint; version: bigint }>>(
        "SELECT player_id, item_id, quantity, version FROM inventory_stacks ORDER BY player_id, item_id FOR UPDATE"
      );
      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
         VALUES (?, ?, ?, 'admin_operator', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, input.operatorId]
      );
      const playerCount = new Set(rows.map((row) => row.player_id.toString())).size;
      const quantityTotal = rows.reduce((total, row) => total + row.quantity, 0n);
      const canonical = rows.map((row) => `${row.player_id}:${row.item_id}:${row.quantity}:${row.version}`).join("\n");
      const contentHash = createHash("sha256").update(canonical).digest("hex");
      const snapshot = await transaction.execute(
        `INSERT INTO inventory_snapshots
          (operation_id, player_count, item_count, quantity_total, content_hash)
         VALUES (?, ?, ?, ?, ?)`,
        [operation.insertId, playerCount, rows.length, quantityTotal, contentHash]
      );
      for (const row of rows) {
        await transaction.execute(
          `INSERT INTO inventory_snapshot_entries
            (snapshot_id, player_id, item_id, quantity, inventory_version) VALUES (?, ?, ?, ?, ?)`,
          [snapshot.insertId, row.player_id, row.item_id, row.quantity, row.version]
        );
      }
      const location = `db://inventory_snapshots/${snapshot.insertId}`;
      const data = `✅ 모든 사용자의 아이템 정보를 저장했습니다.\n📄 저장 위치:\n${location}`;
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
         VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [operation.insertId, input.channelId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
         VALUES (?, 'inventory_snapshot', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [input.eventId, operation.insertId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
         VALUES (?, 'admin_operator', ?, 'inventory_snapshot', ?, 'inventory.snapshot', 'success', 'Iris /소지품저장', ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, snapshot.insertId, JSON.stringify({ playerCount, itemCount: rows.length, quantityTotal: quantityTotal.toString(), contentHash })]
      );
      const result: InventorySnapshotResult = {
        status: "saved", data, snapshotId: snapshot.insertId.toString(), playerCount: String(playerCount),
        itemCount: String(rows.length), quantityTotal: quantityTotal.toString(), contentHash,
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

interface InventorySnapshotInternalInput {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
  operatorId: string;
}
