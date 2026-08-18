import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import type { FixedRangeBoxDefinition, FixedRangeBoxPlan } from "./fixed-range-box-open-policy.js";
import type {
  FixedRangeBoxActor,
  FixedRangeBoxCommandRecord,
  FixedRangeBoxLockedState,
  FixedRangeBoxOpenRepository,
  FixedRangeBoxOpenTransaction,
  FixedRangeBoxStoredResult
} from "./fixed-range-box-open-repository.js";

interface ItemRow { item_id: bigint; code: string; quantity: bigint | null; version: bigint | null; }

class MariaFixedRangeBoxOpenTransaction implements FixedRangeBoxOpenTransaction {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async isCastleSiegeActive(): Promise<boolean> {
    const rows = await this.transaction.query<Array<{ active_count: bigint }>>(
      "SELECT COUNT(*) AS active_count FROM castle_battle_seasons WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))"
    );
    return (rows[0]?.active_count ?? 0n) > 0n;
  }

  async findActor(externalUserId: string): Promise<FixedRangeBoxActor | null> {
    const rows = await this.transaction.query<Array<{ identity_id: bigint; player_id: bigint; rank_label: string }>>(
      `SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name AS rank_label
       FROM external_identities identity JOIN player_profiles profile ON profile.player_id = identity.player_id
       WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked'
         AND identity.player_id IS NOT NULL FOR UPDATE`, [externalUserId]
    );
    const row = rows[0];
    return row === undefined ? null : {
      identityId: row.identity_id.toString(), playerId: row.player_id.toString(), rankLabel: row.rank_label
    };
  }

  async findStoredResult(scope: string, key: string): Promise<FixedRangeBoxStoredResult | null> {
    const rows = await this.transaction.query<Array<{ result_json: string | FixedRangeBoxStoredResult | null }>>(
      "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE", [scope, key]
    );
    const value = rows[0]?.result_json;
    if (value === undefined || value === null) return null;
    return typeof value === "string" ? JSON.parse(value) as FixedRangeBoxStoredResult : value;
  }

  async lockState(actor: FixedRangeBoxActor, definition: FixedRangeBoxDefinition): Promise<FixedRangeBoxLockedState> {
    const codes = [definition.boxCode, definition.rewardCode].sort();
    const rows = await this.transaction.query<ItemRow[]>(
      `SELECT item.id AS item_id, item.code, stack.quantity, stack.version
       FROM item_definitions item LEFT JOIN inventory_stacks stack
         ON stack.item_id = item.id AND stack.player_id = ?
       WHERE item.code IN (?, ?) AND item.active = TRUE AND item.stackable = TRUE
       ORDER BY item.code FOR UPDATE`, [actor.playerId, ...codes]
    );
    const items = new Map(rows.map((row) => [row.code, row]));
    const missing = codes.filter((code) => !items.has(code));
    if (missing.length > 0) {
      throw new ApplicationError("FIXED_RANGE_BOX_CATALOG_REQUIRED", `상자 오픈 아이템 설정을 찾을 수 없습니다: ${missing.join(", ")}`, 409);
    }
    const box = items.get(definition.boxCode)!;
    const reward = items.get(definition.rewardCode)!;
    return {
      boxItemId: box.item_id.toString(),
      boxQuantity: box.quantity ?? 0n,
      boxVersion: box.version,
      rewardItemId: reward.item_id.toString(),
      rewardQuantity: reward.quantity ?? 0n,
      rewardVersion: reward.version,
      rewardStackExists: reward.quantity !== null
    };
  }

  async persist(actor: FixedRangeBoxActor, scope: string, key: string, command: FixedRangeBoxCommandRecord,
    definition: FixedRangeBoxDefinition, state: FixedRangeBoxLockedState, plan: FixedRangeBoxPlan): Promise<FixedRangeBoxStoredResult> {
    const operation = await this.transaction.execute(
      `INSERT INTO operations
         (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, result_json, created_at)
       VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', ?, UTC_TIMESTAMP(3))`,
      [randomUUID(), scope, key, actor.identityId, JSON.stringify({ rngSeed: plan.rngSeed, rngTrace: plan.rngTrace })]
    );

    const boxDelta = -BigInt(plan.effectiveOpenCount);
    if (boxDelta !== 0n) {
      if (state.boxVersion === null) throw new ApplicationError("FIXED_RANGE_BOX_INVENTORY_CONFLICT", "상자 수량이 먼저 변경되었습니다.", 409);
      if (plan.boxAfter === 0n) {
        const write = await this.transaction.execute(
          "DELETE FROM inventory_stacks WHERE player_id = ? AND item_id = ? AND version = ?",
          [actor.playerId, state.boxItemId, state.boxVersion]
        );
        if (write.affectedRows !== 1n) throw new ApplicationError("FIXED_RANGE_BOX_INVENTORY_CONFLICT", "상자 수량이 먼저 변경되었습니다.", 409);
      } else {
        const write = await this.transaction.execute(
          "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
          [plan.boxAfter, actor.playerId, state.boxItemId, state.boxVersion]
        );
        if (write.affectedRows !== 1n) throw new ApplicationError("FIXED_RANGE_BOX_INVENTORY_CONFLICT", "상자 수량이 먼저 변경되었습니다.", 409);
      }
    }

    if (!state.rewardStackExists) {
      await this.transaction.execute(
        "INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, ?, 1)",
        [actor.playerId, state.rewardItemId, plan.rewardAfter]
      );
    } else if (plan.totalQuantity !== 0n) {
      const write = await this.transaction.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [plan.rewardAfter, actor.playerId, state.rewardItemId, state.rewardVersion]
      );
      if (write.affectedRows !== 1n) throw new ApplicationError("FIXED_RANGE_BOX_INVENTORY_CONFLICT", "보상 수량이 먼저 변경되었습니다.", 409);
    }

    await this.transaction.execute(
      `INSERT INTO inventory_ledger
         (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code)
       VALUES (?, 1, ?, ?, ?, 'fixed_range_box_open'), (?, 2, ?, ?, ?, 'fixed_range_box_reward')`,
      [operation.insertId, actor.playerId, state.boxItemId, boxDelta,
        operation.insertId, actor.playerId, state.rewardItemId, plan.totalQuantity]
    );
    const outbox = await this.transaction.execute(
      `INSERT INTO outbox_messages
         (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
       VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [operation.insertId, command.channelId, JSON.stringify({ data: plan.reply, sequence: 1 })]
    );
    await this.transaction.execute(
      `INSERT INTO command_executions
         (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
       VALUES (?, ?, ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [command.eventId, definition.commandCode, operation.insertId]
    );
    const audit = await this.transaction.execute(
      `INSERT INTO command_audit
         (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
       VALUES (?, 'external_identity', ?, 'player', ?, ?, 'success', ?, ?, UTC_TIMESTAMP(3))`,
      [operation.insertId, actor.identityId, actor.playerId, `inventory.${definition.commandCode}`, `Iris ${definition.command}`,
        JSON.stringify({ rawMessage: command.message, parseMode: plan.parseMode, requestedOpenCount: plan.requestedOpenCount,
          effectiveOpenCount: plan.effectiveOpenCount, rngSeed: plan.rngSeed, rngTrace: plan.rngTrace,
          totalQuantity: plan.totalQuantity.toString(), boxBefore: plan.boxBefore.toString(), boxAfter: plan.boxAfter.toString(),
          rewardBefore: plan.rewardBefore.toString(), rewardAfter: plan.rewardAfter.toString(), rewardZeroStackCreated: plan.createRewardZeroStack })]
    );
    const result: FixedRangeBoxStoredResult = {
      status: "opened",
      playerId: actor.playerId,
      commandCode: definition.commandCode,
      data: plan.reply,
      outboxId: outbox.insertId.toString(),
      auditId: audit.insertId.toString(),
      requestedOpenCount: plan.requestedOpenCount,
      effectiveOpenCount: plan.effectiveOpenCount,
      rngSeed: plan.rngSeed,
      rngTrace: plan.rngTrace,
      totalQuantity: plan.totalQuantity.toString(),
      boxBefore: plan.boxBefore.toString(),
      boxAfter: plan.boxAfter.toString(),
      rewardBefore: plan.rewardBefore.toString(),
      rewardAfter: plan.rewardAfter.toString(),
      rewardZeroStackCreated: plan.createRewardZeroStack
    };
    await this.transaction.execute(
      "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
      [JSON.stringify(result), operation.insertId]
    );
    return result;
  }
}

export class MariaFixedRangeBoxOpenRepository implements FixedRangeBoxOpenRepository {
  constructor(private readonly database: DatabaseClient) {}
  async withTransaction<T>(work: (transaction: FixedRangeBoxOpenTransaction) => Promise<T>): Promise<T> {
    return this.database.withTransaction((transaction) => work(new MariaFixedRangeBoxOpenTransaction(transaction)));
  }
}
