import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { OPEN_ALL_ITEMS, type OpenAllPlan, type OpenAllState } from "./open-all-policy.js";
import type { OpenAllActor, OpenAllCommandRecord, OpenAllRepository, OpenAllRepositoryTransaction, OpenAllStoredResult } from "./open-all-repository.js";

interface ItemRow { item_id: bigint; code: string; quantity: bigint | null; version: bigint | null; }

class MariaOpenAllTransaction implements OpenAllRepositoryTransaction {
  private items = new Map<string, ItemRow>();
  private pointBalance = 0n;
  private pointVersion = 0n;

  constructor(private readonly transaction: DatabaseTransaction) {}

  async isCastleSiegeActive(): Promise<boolean> {
    const rows = await this.transaction.query<Array<{ active_count: bigint }>>(
      "SELECT COUNT(*) AS active_count FROM castle_battle_seasons WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))"
    );
    return (rows[0]?.active_count ?? 0n) > 0n;
  }

  async findActor(externalUserId: string): Promise<OpenAllActor | null> {
    const rows = await this.transaction.query<Array<{ identity_id: bigint; player_id: bigint; rank_label: string }>>(
      `SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name AS rank_label
       FROM external_identities identity JOIN player_profiles profile ON profile.player_id = identity.player_id
       WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked'
         AND identity.player_id IS NOT NULL FOR UPDATE`, [externalUserId]
    );
    const row = rows[0];
    return row === undefined ? null : { identityId: row.identity_id.toString(), playerId: row.player_id.toString(), rankLabel: row.rank_label };
  }

  async findStoredResult(scope: string, key: string): Promise<OpenAllStoredResult | null> {
    const rows = await this.transaction.query<Array<{ result_json: string | OpenAllStoredResult | null }>>(
      "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE", [scope, key]
    );
    const value = rows[0]?.result_json;
    if (value === undefined || value === null) return null;
    return typeof value === "string" ? JSON.parse(value) as OpenAllStoredResult : value;
  }

  async lockState(actor: OpenAllActor): Promise<OpenAllState> {
    const codes = [...new Set(OPEN_ALL_ITEMS.map((entry) => entry.code))].sort();
    const placeholders = codes.map(() => "?").join(", ");
    const rows = await this.transaction.query<ItemRow[]>(
      `SELECT item.id AS item_id, item.code, stack.quantity, stack.version
       FROM item_definitions item LEFT JOIN inventory_stacks stack ON stack.item_id = item.id AND stack.player_id = ?
       WHERE item.code IN (${placeholders}) AND item.active = TRUE AND item.stackable = TRUE
       ORDER BY item.code FOR UPDATE`, [actor.playerId, ...codes]
    );
    this.items = new Map(rows.map((row) => [row.code, row]));
    const missing = codes.filter((code) => !this.items.has(code));
    if (missing.length > 0) throw new ApplicationError("OPEN_ALL_CATALOG_REQUIRED", `전체오픈 아이템 설정을 찾을 수 없습니다: ${missing.join(", ")}`, 409);

    await this.transaction.execute("INSERT IGNORE INTO currency_accounts (player_id, currency_code, balance, version) VALUES (?, 'point', 0, 1)", [actor.playerId]);
    const pointRows = await this.transaction.query<Array<{ balance: string; version: bigint }>>(
      "SELECT balance, version FROM currency_accounts WHERE player_id = ? AND currency_code = 'point' FOR UPDATE", [actor.playerId]
    );
    const point = pointRows[0];
    if (point === undefined) throw new ApplicationError("OPEN_ALL_POINT_ACCOUNT_REQUIRED", "포인트 계정을 찾을 수 없습니다.", 409);
    this.pointBalance = BigInt(point.balance.split(".")[0] ?? "0"); this.pointVersion = point.version;
    return { rankLabel: actor.rankLabel, point: this.pointBalance,
      quantities: Object.fromEntries(rows.filter((row) => row.quantity !== null).map((row) => [row.code, row.quantity!])) };
  }

  async persist(actor: OpenAllActor, scope: string, key: string, command: OpenAllCommandRecord, plan: OpenAllPlan): Promise<OpenAllStoredResult> {
    const operation = await this.transaction.execute(
      "INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, result_json, created_at) VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', ?, UTC_TIMESTAMP(3))",
      [randomUUID(), scope, key, actor.identityId, JSON.stringify({ randomTrace: plan.randomTrace, openedBoxes: plan.openedBoxes })]
    );
    let inventorySequence = 0;
    for (const code of Object.keys(plan.deltas).sort()) {
      const row = this.items.get(code)!; const after = plan.quantities[code] ?? 0n; const change = plan.deltas[code]!;
      if (row.quantity === null || row.version === null) {
        if (after > 0n) await this.transaction.execute("INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, ?, 1)", [actor.playerId, row.item_id, after]);
      } else if (after === 0n) {
        const write = await this.transaction.execute("DELETE FROM inventory_stacks WHERE player_id = ? AND item_id = ? AND version = ?", [actor.playerId, row.item_id, row.version]);
        if (write.affectedRows !== 1n) throw new ApplicationError("OPEN_ALL_INVENTORY_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
      } else {
        const write = await this.transaction.execute("UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?", [after, actor.playerId, row.item_id, row.version]);
        if (write.affectedRows !== 1n) throw new ApplicationError("OPEN_ALL_INVENTORY_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
      }
      inventorySequence++;
      await this.transaction.execute("INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, ?, ?, ?, ?, 'open_all')",
        [operation.insertId, inventorySequence, actor.playerId, row.item_id, change]);
    }

    if (plan.pointDelta !== 0n) {
      const balance = this.pointBalance + plan.pointDelta;
      const write = await this.transaction.execute("UPDATE currency_accounts SET balance = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE player_id = ? AND currency_code = 'point' AND version = ?",
        [balance, actor.playerId, this.pointVersion]);
      if (write.affectedRows !== 1n) throw new ApplicationError("OPEN_ALL_POINT_CONFLICT", "포인트 정보가 먼저 변경되었습니다.", 409);
      await this.transaction.execute("INSERT INTO currency_ledger (operation_id, sequence_no, player_id, currency_code, delta, balance_after, reason_code) VALUES (?, 1, ?, 'point', ?, ?, 'open_all')",
        [operation.insertId, actor.playerId, plan.pointDelta, balance]);
    }

    const outbox = await this.transaction.execute(
      "INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at) VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [operation.insertId, command.channelId, JSON.stringify({ data: plan.reply, sequence: 1 })]
    );
    await this.transaction.execute(
      "INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at) VALUES (?, 'open_all', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [command.eventId, operation.insertId]
    );
    const audit = await this.transaction.execute(
      "INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at) VALUES (?, 'external_identity', ?, 'player', ?, 'inventory.open_all', 'success', 'Iris /전체오픈', ?, UTC_TIMESTAMP(3))",
      [operation.insertId, actor.identityId, actor.playerId, JSON.stringify({ deltas: Object.fromEntries(Object.entries(plan.deltas).map(([code, value]) => [code, value.toString()])), pointDelta: plan.pointDelta.toString(), randomTrace: plan.randomTrace, openedBoxes: plan.openedBoxes, deferredGuildItems: plan.deferredGuildItems })]
    );
    const result: OpenAllStoredResult = { status: "opened", playerId: actor.playerId, data: plan.reply,
      outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(), pointDelta: plan.pointDelta.toString(),
      randomTrace: plan.randomTrace, openedBoxes: plan.openedBoxes, deferredGuildItems: plan.deferredGuildItems };
    await this.transaction.execute("UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?", [JSON.stringify(result), operation.insertId]);
    return result;
  }
}

export class MariaOpenAllRepository implements OpenAllRepository {
  constructor(private readonly database: DatabaseClient) {}
  async withTransaction<T>(work: (transaction: OpenAllRepositoryTransaction) => Promise<T>): Promise<T> {
    return this.database.withTransaction((transaction) => work(new MariaOpenAllTransaction(transaction)));
  }
}
