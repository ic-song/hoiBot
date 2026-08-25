import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import type {
  BagSellInput,
  BagSellRepository,
  BagSellResult,
  ParsedBagSellCommand
} from "./bag-sell.js";

interface SnapshotTargetRow {
  snapshot_id: bigint;
  item_id: bigint;
  item_code: string;
  catalog_object_key: string | null;
  stack_version: bigint;
  snapshot_quantity: bigint;
  display_name: string;
  metadata_json: string | Record<string, unknown>;
}

function eventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : "sha256:" + createHash("sha256").update(eventId).digest("hex");
}

function parseStored(value: string | BagSellResult): BagSellResult {
  return typeof value === "string" ? JSON.parse(value) as BagSellResult : value;
}

function parseMetadata(value: string | Record<string, unknown>): Record<string, unknown> {
  return typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : value;
}

function formatPoint(value: bigint): string {
  return value.toLocaleString("ko-KR");
}

// 최신 가방 snapshot의 stable definition ID를 잠근 뒤 재고와 포인트를 원자 변경합니다.
export class MariaBagSellRepository implements BagSellRepository {
  constructor(private readonly database: DatabaseClient) {}

  async sell(input: BagSellInput & ParsedBagSellCommand): Promise<BagSellResult> {
    return this.database.withTransaction(async (transaction) => {
      const identities = await transaction.query<Array<{ player_id: bigint }>>(
        `SELECT player_id FROM external_identities
          WHERE provider_code = ? AND external_user_id = ? AND status = 'linked' AND player_id IS NOT NULL
          LIMIT 1 FOR UPDATE`,
        [input.providerCode, input.externalUserId]
      );
      const playerId = identities[0]?.player_id;
      if (playerId === undefined) {
        return { status: "identity_not_found", data: "연결된 캐릭터를 찾을 수 없습니다." };
      }

      const scope = "inventory.bag_sell:" + playerId.toString();
      const key = eventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | BagSellResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, key]
      );
      if (prior[0] !== undefined) {
        if (prior[0].result_json === null) throw new Error("Bag sell operation is still processing.");
        return { ...parseStored(prior[0].result_json), replayed: true };
      }

      const targets = await transaction.query<SnapshotTargetRow[]>(
        `SELECT snapshot.id AS snapshot_id, entry.item_id, entry.item_code,
                registry.object_key AS catalog_object_key, entry.stack_version,
                entry.quantity AS snapshot_quantity, item.display_name, item.metadata_json
           FROM bag_selection_snapshots snapshot
           JOIN bag_selection_snapshot_entries entry ON entry.snapshot_id = snapshot.id
           JOIN item_definitions item ON item.id = entry.item_id
           LEFT JOIN object_registry registry ON registry.id = entry.catalog_object_id
          WHERE snapshot.player_id = ? AND snapshot.expires_at > UTC_TIMESTAMP(3)
            AND entry.display_seq = ?
          ORDER BY snapshot.id DESC LIMIT 1 FOR UPDATE`,
        [playerId, input.displaySeq]
      );
      const target = targets[0];
      if (target === undefined) {
        return {
          status: "snapshot_required",
          data: "가방 목록이 없거나 만료되었습니다. /가방을 다시 확인해 주세요.",
          playerId: playerId.toString()
        };
      }
      const stacks = await transaction.query<Array<{ quantity: bigint; version: bigint }>>(
        "SELECT quantity, version FROM inventory_stacks WHERE player_id = ? AND item_id = ? FOR UPDATE",
        [playerId, target.item_id]
      );
      const stack = stacks[0];
      if (
        stack === undefined ||
        stack.version !== target.stack_version ||
        stack.quantity !== target.snapshot_quantity
      ) {
        return {
          status: "stale_snapshot",
          data: "가방 내용이 변경되었습니다. /가방을 다시 확인한 뒤 판매해 주세요.",
          playerId: playerId.toString(),
          snapshotId: target.snapshot_id.toString(),
          definitionId: target.item_id.toString(),
          catalogObjectKey: target.catalog_object_key
        };
      }
      const metadata = parseMetadata(target.metadata_json);
      if (metadata.neverSell === true || metadata.sellable === false) {
        return {
          status: "item_not_sellable",
          data: target.display_name + "은(는) 판매할 수 없는 아이템입니다.",
          playerId: playerId.toString(),
          snapshotId: target.snapshot_id.toString(),
          definitionId: target.item_id.toString(),
          itemCode: target.item_code,
          itemName: target.display_name
        };
      }

      const quantity = input.quantity ?? stack.quantity;
      if (quantity > stack.quantity) {
        return {
          status: "insufficient_quantity",
          data: "판매할 수량이 가방의 보유 수량보다 많습니다.",
          playerId: playerId.toString(),
          snapshotId: target.snapshot_id.toString(),
          definitionId: target.item_id.toString(),
          itemCode: target.item_code,
          itemName: target.display_name
        };
      }
      const pointDelta = quantity * 100000n;
      await transaction.execute(
        "INSERT IGNORE INTO currency_accounts (player_id, currency_code, balance, version) VALUES (?, 'point', 0, 1)",
        [playerId]
      );
      const accounts = await transaction.query<Array<{ balance: string; version: bigint }>>(
        "SELECT balance, version FROM currency_accounts WHERE player_id = ? AND currency_code = 'point' FOR UPDATE",
        [playerId]
      );
      const account = accounts[0];
      if (account === undefined) throw new Error("Point account is required.");
      const balance = BigInt(account.balance.split(".")[0] ?? "0") + pointDelta;
      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
         VALUES (?, ?, ?, 'player', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, key, playerId]
      );

      if (quantity > 0n) {
        const remaining = stack.quantity - quantity;
        const inventoryWrite = remaining === 0n
          ? await transaction.execute(
            "DELETE FROM inventory_stacks WHERE player_id = ? AND item_id = ? AND version = ?",
            [playerId, target.item_id, stack.version]
          )
          : await transaction.execute(
            "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
            [remaining, playerId, target.item_id, stack.version]
          );
        if (inventoryWrite.affectedRows !== 1n) throw new Error("Bag sell inventory version conflict.");
        await transaction.execute(
          `INSERT INTO inventory_ledger
            (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code)
           VALUES (?, 1, ?, ?, ?, 'bag_sell')`,
          [operation.insertId, playerId, target.item_id, -quantity]
        );
      }

      const currencyWrite = await transaction.execute(
        `UPDATE currency_accounts
            SET balance = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
          WHERE player_id = ? AND currency_code = 'point' AND version = ?`,
        [balance, playerId, account.version]
      );
      if (currencyWrite.affectedRows !== 1n) throw new Error("Bag sell point version conflict.");
      await transaction.execute(
        `INSERT INTO currency_ledger
          (operation_id, sequence_no, player_id, currency_code, delta, balance_after, reason_code)
         VALUES (?, 1, ?, 'point', ?, ?, 'bag_sell')`,
        [operation.insertId, playerId, pointDelta, balance]
      );

      const data =
        target.display_name + " x " + quantity.toString() + "개를 판매했습니다.\n" +
        "획득 포인트: " + formatPoint(pointDelta) + "P";
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
         VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [operation.insertId, input.channelId, JSON.stringify({ data, sequence: 1 })]
      );
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
         VALUES (?, 'bag_sell', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [input.eventId, operation.insertId]
      );
      await transaction.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
         VALUES (?, 'player', ?, 'item_definition', ?, 'inventory.bag_sell', 'success', 'Iris /판매', ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, playerId, target.item_id, JSON.stringify({
          snapshotId: target.snapshot_id.toString(),
          displaySeq: input.displaySeq,
          definitionId: target.item_id.toString(),
          catalogObjectKey: target.catalog_object_key,
          itemCode: target.item_code,
          quantity: quantity.toString(),
          pointDelta: pointDelta.toString()
        })]
      );
      const result: BagSellResult = {
        status: "sold",
        data,
        playerId: playerId.toString(),
        snapshotId: target.snapshot_id.toString(),
        definitionId: target.item_id.toString(),
        catalogObjectKey: target.catalog_object_key,
        itemCode: target.item_code,
        itemName: target.display_name,
        quantity: quantity.toString(),
        pointDelta: pointDelta.toString(),
        pointBalance: balance.toString(),
        operationId: operation.insertId.toString(),
        outboxId: outbox.insertId.toString(),
        replayed: false
      };
      await transaction.execute(
        "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }
}
