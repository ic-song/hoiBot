import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { buildMinipetPackageGrantReply, type ParsedMinipetPackageGrant } from "./minipet-package-grant-policy.js";
import type {
  MinipetPackageGrantCommand,
  MinipetPackageGrantRepository,
  MinipetPackageGrantStoredResult,
  MinipetPackageGrantTransaction
} from "./minipet-package-grant-repository.js";

const MAX_LEDGER_QUANTITY = 9223372036854775807n;

function parseStored(value: string | MinipetPackageGrantStoredResult): MinipetPackageGrantStoredResult {
  return typeof value === "string" ? JSON.parse(value) as MinipetPackageGrantStoredResult : value;
}

function parseMetadata(value: string | Record<string, unknown> | null): Record<string, unknown> {
  if (value === null) return {};
  return typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : value;
}

class MariaMinipetPackageGrantTransaction implements MinipetPackageGrantTransaction {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async findAuthorizedOperator(externalUserId: string): Promise<string | null> {
    const rows = await this.transaction.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id
       FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id = identity.id
       JOIN admin_operators operator ON operator.id = mapping.operator_id
       WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
         AND identity.status = 'linked' AND operator.status = 'active'
         AND (
           EXISTS (
             SELECT 1 FROM admin_operator_roles operator_role
             JOIN admin_role_permissions role_permission ON role_permission.role_id = operator_role.role_id
             WHERE operator_role.operator_id = operator.id AND role_permission.permission_code = 'game.inventory.change'
           ) OR EXISTS (
             SELECT 1 FROM admin_operator_permission_overrides permission_override
             WHERE permission_override.operator_id = operator.id
               AND permission_override.permission_code = 'game.inventory.change' AND permission_override.effect = 'allow'
           )
         )
         AND NOT EXISTS (
           SELECT 1 FROM admin_operator_permission_overrides permission_override
           WHERE permission_override.operator_id = operator.id
             AND permission_override.permission_code = 'game.inventory.change' AND permission_override.effect = 'deny'
         )
       ORDER BY mapping.operator_id LIMIT 1 FOR UPDATE`, [externalUserId]
    );
    return rows[0]?.operator_id.toString() ?? null;
  }

  async findStoredResult(scope: string, key: string): Promise<MinipetPackageGrantStoredResult | null> {
    const rows = await this.transaction.query<Array<{ result_json: string | MinipetPackageGrantStoredResult | null }>>(
      "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE", [scope, key]
    );
    const value = rows[0]?.result_json;
    return value === undefined || value === null ? null : parseStored(value);
  }

  async grant(operatorId: string, scope: string, key: string, command: MinipetPackageGrantCommand,
    parsed: ParsedMinipetPackageGrant): Promise<MinipetPackageGrantStoredResult | null> {
    const targets = await this.transaction.query<Array<{ player_id: bigint; current_display_name: string }>>(
      "SELECT player_id, current_display_name FROM player_profiles WHERE current_display_name = ? ORDER BY player_id LIMIT 2 FOR UPDATE",
      [parsed.targetName]
    );
    if (targets.length !== 1) return null;
    const target = targets[0]!;
    const definitions = await this.transaction.query<Array<{
      id: bigint; code: string; display_name: string; metadata_json: string | Record<string, unknown> | null;
      active: number | boolean; stackable: number | boolean;
    }>>(
      `SELECT id, code, display_name, metadata_json, active, stackable
       FROM item_definitions WHERE code = ? FOR UPDATE`, [parsed.definition.itemCode]
    );
    const item = definitions[0];
    if (item === undefined) {
      throw new ApplicationError("MINIPET_PACKAGE_ITEM_DEFINITION_REQUIRED", `패키지 아이템 정의를 찾을 수 없습니다: ${parsed.definition.itemCode}`, 409);
    }
    const metadata = parseMetadata(item.metadata_json);
    if (!Boolean(item.active) || !Boolean(item.stackable) || item.display_name !== parsed.definition.itemName
      || metadata.legacyName !== parsed.definition.itemName) {
      throw new ApplicationError("MINIPET_PACKAGE_ITEM_DEFINITION_INVALID", `패키지 아이템 정의가 현행과 다릅니다: ${parsed.definition.itemCode}`, 409);
    }
    await this.transaction.execute(
      "INSERT IGNORE INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, 0, 0)",
      [target.player_id, item.id]
    );
    const stacks = await this.transaction.query<Array<{ quantity: bigint; version: bigint }>>(
      "SELECT quantity, version FROM inventory_stacks WHERE player_id = ? AND item_id = ? FOR UPDATE",
      [target.player_id, item.id]
    );
    const stack = stacks[0]!;
    if (parsed.amount > MAX_LEDGER_QUANTITY || stack.quantity > MAX_LEDGER_QUANTITY - parsed.amount) {
      throw new ApplicationError("MINIPET_PACKAGE_QUANTITY_RANGE", "지급 수량이 저장 범위를 초과합니다.", 409);
    }
    const quantityAfter = stack.quantity + parsed.amount;
    const operation = await this.transaction.execute(
      `INSERT INTO operations
         (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, result_json, created_at)
       VALUES (?, ?, ?, 'admin_operator', ?, 'iris', 'processing', ?, UTC_TIMESTAMP(3))`,
      [randomUUID(), scope, key, operatorId, JSON.stringify({ commandCode: parsed.definition.commandCode })]
    );
    const update = await this.transaction.execute(
      "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
      [quantityAfter, target.player_id, item.id, stack.version]
    );
    if (update.affectedRows !== 1n) throw new ApplicationError("MINIPET_PACKAGE_STACK_CONFLICT", "패키지 수량이 먼저 변경되었습니다.", 409);
    await this.transaction.execute(
      `INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code)
       VALUES (?, 1, ?, ?, ?, 'admin_minipet_package_grant')`,
      [operation.insertId, target.player_id, item.id, parsed.amount]
    );
    await this.transaction.execute(
      `INSERT INTO command_executions
         (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
       VALUES (?, ?, ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [command.eventId, parsed.definition.commandCode, operation.insertId]
    );
    const audit = await this.transaction.execute(
      `INSERT INTO command_audit
         (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
       VALUES (?, 'admin_operator', ?, 'player', ?, 'admin.minipet_package_grant', 'success', ?, ?, UTC_TIMESTAMP(3))`,
      [operation.insertId, operatorId, target.player_id, `Iris ${parsed.definition.command}`, JSON.stringify({
        commandCode: parsed.definition.commandCode, itemCode: item.code, targetName: target.current_display_name,
        quantityBefore: stack.quantity.toString(), quantityDelta: parsed.amount.toString(), quantityAfter: quantityAfter.toString()
      })]
    );
    const data = buildMinipetPackageGrantReply(target.current_display_name, parsed.definition.itemName, parsed.amount);
    const outbox = await this.transaction.execute(
      `INSERT INTO outbox_messages
         (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
       VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [operation.insertId, command.channelId, JSON.stringify({ data, sequence: 1, kind: "admin_minipet_package_grant" })]
    );
    const result: MinipetPackageGrantStoredResult = {
      status: "granted", operatorId, playerId: target.player_id.toString(), commandCode: parsed.definition.commandCode,
      itemCode: item.code, itemName: parsed.definition.itemName, targetName: target.current_display_name,
      quantityDelta: parsed.amount.toString(), quantityBefore: stack.quantity.toString(), quantityAfter: quantityAfter.toString(),
      data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString()
    };
    await this.transaction.execute(
      "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
      [JSON.stringify(result), operation.insertId]
    );
    return result;
  }
}

export class MariaMinipetPackageGrantRepository implements MinipetPackageGrantRepository {
  constructor(private readonly database: DatabaseClient) {}
  async withTransaction<T>(work: (transaction: MinipetPackageGrantTransaction) => Promise<T>): Promise<T> {
    return this.database.withTransaction((transaction) => work(new MariaMinipetPackageGrantTransaction(transaction)));
  }
}
