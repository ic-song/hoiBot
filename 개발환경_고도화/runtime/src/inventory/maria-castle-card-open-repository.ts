import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import {
  CASTLE_CARD_COMMAND_CODE,
  CASTLE_CARD_CONSUMER,
  CASTLE_CARD_REWARDS,
  type CastleCardOpenPlan
} from "./castle-card-open-policy.js";
import type {
  CastleCardActor,
  CastleCardCommandRecord,
  CastleCardItemState,
  CastleCardLockedState,
  CastleCardOpenRepository,
  CastleCardOpenTransaction,
  CastleCardStoredResult
} from "./castle-card-open-repository.js";

interface ItemRow { item_id: bigint; code: string; quantity: bigint | null; version: bigint | null; }

class MariaCastleCardOpenTransaction implements CastleCardOpenTransaction {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async findActor(externalUserId: string): Promise<CastleCardActor | null> {
    const rows = await this.transaction.query<Array<{
      identity_id: bigint; player_id: bigint; rank_label: string; sender_name: string;
    }>>(
      `SELECT identity.id AS identity_id, identity.player_id,
         profile.current_display_name AS rank_label,
         COALESCE(identity.display_name, profile.current_display_name) AS sender_name
       FROM external_identities identity JOIN player_profiles profile ON profile.player_id = identity.player_id
       WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked'
         AND identity.player_id IS NOT NULL FOR UPDATE`, [externalUserId]
    );
    const row = rows[0];
    return row === undefined ? null : {
      identityId: row.identity_id.toString(), playerId: row.player_id.toString(),
      rankLabel: row.rank_label, senderName: row.sender_name
    };
  }

  async findStoredResult(scope: string, key: string): Promise<CastleCardStoredResult | null> {
    const rows = await this.transaction.query<Array<{ result_json: string | CastleCardStoredResult | null }>>(
      "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE", [scope, key]
    );
    const value = rows[0]?.result_json;
    if (value === undefined || value === null) return null;
    return typeof value === "string" ? JSON.parse(value) as CastleCardStoredResult : value;
  }

  async lockState(actor: CastleCardActor): Promise<CastleCardLockedState> {
    const codes = [CASTLE_CARD_CONSUMER.code, ...CASTLE_CARD_REWARDS.map(({ code }) => code)].sort();
    const placeholders = codes.map(() => "?").join(", ");
    const rows = await this.transaction.query<ItemRow[]>(
      `SELECT item.id AS item_id, item.code, stack.quantity, stack.version
       FROM item_definitions item LEFT JOIN inventory_stacks stack
         ON stack.item_id = item.id AND stack.player_id = ?
       WHERE item.code IN (${placeholders}) AND item.active = TRUE AND item.stackable = TRUE
       ORDER BY item.code FOR UPDATE`, [actor.playerId, ...codes]
    );
    const found = new Map(rows.map((row) => [row.code, row]));
    const missing = codes.filter((code) => !found.has(code));
    if (missing.length > 0) {
      throw new ApplicationError("CASTLE_CARD_CATALOG_REQUIRED", `카드 오픈 아이템 설정을 찾을 수 없습니다: ${missing.join(", ")}`, 409);
    }
    const items = new Map<string, CastleCardItemState>();
    for (const code of codes) {
      const row = found.get(code)!;
      items.set(code, {
        itemId: row.item_id.toString(), quantity: row.quantity ?? 0n,
        version: row.version, stackExists: row.quantity !== null
      });
    }
    return { items };
  }

  async isCastleSiegeActive(): Promise<boolean> {
    const rows = await this.transaction.query<Array<{ active_count: bigint }>>(
      "SELECT COUNT(*) AS active_count FROM castle_battle_seasons WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))"
    );
    return (rows[0]?.active_count ?? 0n) > 0n;
  }

  async persist(actor: CastleCardActor, scope: string, key: string, command: CastleCardCommandRecord,
    state: CastleCardLockedState, plan: CastleCardOpenPlan): Promise<CastleCardStoredResult> {
    const operation = await this.transaction.execute(
      `INSERT INTO operations
         (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, result_json, created_at)
       VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', ?, UTC_TIMESTAMP(3))`,
      [randomUUID(), scope, key, actor.identityId, JSON.stringify({ rngSeed: plan.rngSeed, rngTrace: plan.rngTrace })]
    );
    const consumer = state.items.get(CASTLE_CARD_CONSUMER.code)!;
    if (consumer.version === null) throw new ApplicationError("CASTLE_CARD_INVENTORY_CONFLICT", "소비 아이템 수량이 먼저 변경되었습니다.", 409);
    const consumerAfter = consumer.quantity - BigInt(plan.openCount);
    if (consumerAfter === 0n) {
      const write = await this.transaction.execute(
        "DELETE FROM inventory_stacks WHERE player_id = ? AND item_id = ? AND version = ?",
        [actor.playerId, consumer.itemId, consumer.version]
      );
      if (write.affectedRows !== 1n) throw new ApplicationError("CASTLE_CARD_INVENTORY_CONFLICT", "소비 아이템 수량이 먼저 변경되었습니다.", 409);
    } else {
      const write = await this.transaction.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [consumerAfter, actor.playerId, consumer.itemId, consumer.version]
      );
      if (write.affectedRows !== 1n) throw new ApplicationError("CASTLE_CARD_INVENTORY_CONFLICT", "소비 아이템 수량이 먼저 변경되었습니다.", 409);
    }

    let ledgerSequence = 1;
    await this.transaction.execute(
      "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, ?, ?, ?, ?, 'castle_card_open_consume')",
      [operation.insertId, ledgerSequence++, actor.playerId, consumer.itemId, -BigInt(plan.openCount)]
    );
    for (const aggregate of plan.aggregates) {
      const reward = state.items.get(aggregate.rewardCode)!;
      const delta = BigInt(aggregate.quantity);
      const rewardAfter = reward.quantity + delta;
      if (!reward.stackExists) {
        await this.transaction.execute(
          "INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, ?, 1)",
          [actor.playerId, reward.itemId, rewardAfter]
        );
      } else {
        const write = await this.transaction.execute(
          "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
          [rewardAfter, actor.playerId, reward.itemId, reward.version]
        );
        if (write.affectedRows !== 1n) throw new ApplicationError("CASTLE_CARD_INVENTORY_CONFLICT", "보상 아이템 수량이 먼저 변경되었습니다.", 409);
      }
      await this.transaction.execute(
        "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, ?, ?, ?, ?, 'castle_card_open_reward')",
        [operation.insertId, ledgerSequence++, actor.playerId, reward.itemId, delta]
      );
    }

    const immediate = await this.transaction.execute(
      `INSERT INTO outbox_messages
         (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
       VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [operation.insertId, command.channelId, JSON.stringify({ data: plan.immediateReply, sequence: 1, kind: "immediate" })]
    );
    const delayedOutboxIds: string[] = [];
    const delayedMessages = [
      { data: plan.delayedReply, kind: "result" },
      ...plan.specialNotices.map((data) => ({ data, kind: "special_notice" }))
    ];
    for (let index = 0; index < delayedMessages.length; index++) {
      const message = delayedMessages[index]!;
      const outbox = await this.transaction.execute(
        `INSERT INTO outbox_messages
           (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
         VALUES (?, 'iris', ?, 'text', ?, 'pending', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 800000 MICROSECOND), UTC_TIMESTAMP(3))`,
        [operation.insertId, command.channelId, JSON.stringify({ data: message.data, sequence: index + 2, kind: message.kind })]
      );
      delayedOutboxIds.push(outbox.insertId.toString());
    }
    await this.transaction.execute(
      `INSERT INTO command_executions
         (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
       VALUES (?, ?, ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [command.eventId, CASTLE_CARD_COMMAND_CODE, operation.insertId]
    );
    const audit = await this.transaction.execute(
      `INSERT INTO command_audit
         (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
       VALUES (?, 'external_identity', ?, 'player', ?, 'inventory.castle_card_open', 'success', 'Iris /카드오픈', ?, UTC_TIMESTAMP(3))`,
      [operation.insertId, actor.identityId, actor.playerId, JSON.stringify({
        rawMessage: command.message, parseMode: plan.parseMode, openCount: plan.openCount,
        consumerCode: CASTLE_CARD_CONSUMER.code, consumerBefore: consumer.quantity.toString(), consumerAfter: consumerAfter.toString(),
        rngSeed: plan.rngSeed, rngTrace: plan.rngTrace, aggregates: plan.aggregates,
        outboxSequence: ["immediate", "result", ...plan.specialNotices.map(() => "special_notice")]
      })]
    );
    const result: CastleCardStoredResult = {
      status: "opened", playerId: actor.playerId, commandCode: CASTLE_CARD_COMMAND_CODE,
      immediateOutboxId: immediate.insertId.toString(), immediateData: plan.immediateReply,
      delayedOutboxIds, auditId: audit.insertId.toString(), openCount: plan.openCount,
      rngSeed: plan.rngSeed, rngTrace: plan.rngTrace, aggregates: plan.aggregates
    };
    await this.transaction.execute(
      "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
      [JSON.stringify(result), operation.insertId]
    );
    return result;
  }
}

export class MariaCastleCardOpenRepository implements CastleCardOpenRepository {
  constructor(private readonly database: DatabaseClient) {}
  async withTransaction<T>(work: (transaction: CastleCardOpenTransaction) => Promise<T>): Promise<T> {
    return this.database.withTransaction((transaction) => work(new MariaCastleCardOpenTransaction(transaction)));
  }
}
