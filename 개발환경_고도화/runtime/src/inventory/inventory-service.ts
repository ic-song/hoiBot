import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { positiveInteger } from "../shared/numeric-policy.js";
import { TransactionalOperationRunner, type OperationActor } from "../shared/transactional-operation.js";

interface InventoryCommandBase {
  playerId: string; itemCode: string; reasonCode: string; reason: string; idempotencyKey: string;
  actor: OperationActor; sourceCode: "admin_api" | "iris" | "discord" | "external_api" | "system";
}

// stack/instance 소유권과 inventory ledger를 동일 트랜잭션으로 관리합니다.
export class InventoryService {
  private readonly operations: TransactionalOperationRunner;
  constructor(database: DatabaseClient) { this.operations = new TransactionalOperationRunner(database); }

  async changeStack(command: InventoryCommandBase & { quantityDelta: string; expectedVersion: string }): Promise<{ quantity: string; version: string; auditId: string }> {
    if (!/^-?\d+$/.test(command.quantityDelta) || BigInt(command.quantityDelta) === 0n) throw new ApplicationError("INVALID_QUANTITY_DELTA", "수량 변경값은 0이 아닌 정수여야 합니다.", 422);
    const delta = BigInt(command.quantityDelta);
    return this.operations.run({ scope: `inventory.stack:${command.playerId}:${command.itemCode}`, idempotencyKey: command.idempotencyKey,
      actor: command.actor, sourceCode: command.sourceCode, actionCode: "inventory.stack.change", targetType: "player", targetId: command.playerId,
      reason: command.reason, outboxType: "inventory.changed" }, async (transaction, operationId) => {
      const items = await transaction.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code = ? AND active = TRUE AND stackable = TRUE", [command.itemCode]);
      const item = items[0]; if (item === undefined) throw new ApplicationError("STACKABLE_ITEM_NOT_FOUND", "사용 가능한 stack 아이템을 찾을 수 없습니다.", 404);
      await transaction.execute("INSERT IGNORE INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, 0, 0)", [command.playerId, item.id]);
      const stacks = await transaction.query<Array<{ quantity: bigint; version: bigint }>>("SELECT quantity, version FROM inventory_stacks WHERE player_id = ? AND item_id = ? FOR UPDATE", [command.playerId, item.id]);
      const stack = stacks[0]!;
      if (stack.version.toString() !== command.expectedVersion) throw new ApplicationError("INVENTORY_VERSION_CONFLICT", "인벤토리가 먼저 변경되었습니다.", 409);
      const quantity = stack.quantity + delta;
      if (quantity < 0n) throw new ApplicationError("INSUFFICIENT_ITEM", "아이템 수량이 부족합니다.", 409);
      const version = stack.version + 1n;
      await transaction.execute("UPDATE inventory_stacks SET quantity = ?, version = ? WHERE player_id = ? AND item_id = ? AND version = ?", [quantity, version, command.playerId, item.id, stack.version]);
      await transaction.execute("INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, 1, ?, ?, ?, ?)", [operationId, command.playerId, item.id, delta, command.reasonCode]);
      return { result: { quantity: quantity.toString(), version: version.toString() }, changeSummary: { itemCode: command.itemCode, quantityDelta: delta.toString(), quantity: quantity.toString() } };
    });
  }

  async grantInstance(command: InventoryCommandBase & { attributes?: Record<string, unknown> }): Promise<{ instanceId: string; auditId: string }> {
    return this.operations.run({ scope: `inventory.instance.grant:${command.playerId}:${command.itemCode}`, idempotencyKey: command.idempotencyKey,
      actor: command.actor, sourceCode: command.sourceCode, actionCode: "inventory.instance.grant", targetType: "player", targetId: command.playerId,
      reason: command.reason, outboxType: "inventory.changed" }, async (transaction, operationId) => {
      const items = await transaction.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code = ? AND active = TRUE AND stackable = FALSE", [command.itemCode]);
      const item = items[0]; if (item === undefined) throw new ApplicationError("INSTANCE_ITEM_NOT_FOUND", "사용 가능한 instance 아이템을 찾을 수 없습니다.", 404);
      const instance = await transaction.execute("INSERT INTO inventory_instances (player_id, item_id, attributes_json) VALUES (?, ?, ?)", [command.playerId, item.id, command.attributes === undefined ? null : JSON.stringify(command.attributes)]);
      await transaction.execute("INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, instance_id, quantity_delta, reason_code) VALUES (?, 1, ?, ?, ?, 1, ?)", [operationId, command.playerId, item.id, instance.insertId, command.reasonCode]);
      return { result: { instanceId: instance.insertId.toString() }, changeSummary: { itemCode: command.itemCode, instanceId: instance.insertId.toString() } };
    });
  }

  async transferInstance(command: Omit<InventoryCommandBase, "itemCode"> & { instanceId: string; toPlayerId: string; expectedVersion: string }): Promise<{ instanceId: string; version: string; auditId: string }> {
    positiveInteger(command.instanceId, "instanceId");
    return this.operations.run({ scope: `inventory.instance.transfer:${command.instanceId}`, idempotencyKey: command.idempotencyKey,
      actor: command.actor, sourceCode: command.sourceCode, actionCode: "inventory.instance.transfer", targetType: "inventory_instance", targetId: command.instanceId,
      reason: command.reason, outboxType: "inventory.transferred" }, async (transaction, operationId) => {
      const rows = await transaction.query<Array<{ player_id: bigint; item_id: bigint; version: bigint; status: string }>>("SELECT player_id, item_id, version, status FROM inventory_instances WHERE id = ? FOR UPDATE", [command.instanceId]);
      const instance = rows[0];
      if (instance === undefined || instance.status !== "owned" || instance.player_id.toString() !== command.playerId) throw new ApplicationError("INSTANCE_NOT_OWNED", "소유한 아이템 instance를 찾을 수 없습니다.", 404);
      if (instance.version.toString() !== command.expectedVersion) throw new ApplicationError("INVENTORY_VERSION_CONFLICT", "아이템 소유권이 먼저 변경되었습니다.", 409);
      const version = instance.version + 1n;
      await transaction.execute("UPDATE inventory_instances SET player_id = ?, version = ? WHERE id = ? AND version = ?", [command.toPlayerId, version, command.instanceId, instance.version]);
      await transaction.execute("INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, instance_id, quantity_delta, reason_code) VALUES (?, 1, ?, ?, ?, -1, ?), (?, 2, ?, ?, ?, 1, ?)", [operationId, command.playerId, instance.item_id, command.instanceId, command.reasonCode, operationId, command.toPlayerId, instance.item_id, command.instanceId, command.reasonCode]);
      return { result: { instanceId: command.instanceId, version: version.toString() }, changeSummary: { fromPlayerId: command.playerId, toPlayerId: command.toPlayerId, instanceId: command.instanceId } };
    });
  }
}
