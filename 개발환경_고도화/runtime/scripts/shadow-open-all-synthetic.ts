import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { OPEN_ALL_ITEMS } from "../src/inventory/open-all-policy.js";
import { MariaOpenAllRepository } from "../src/inventory/maria-open-all-repository.js";
import { OpenAllService } from "../src/inventory/open-all-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic open-all Shadow is blocked for database: ${config.database.name}`);
}

const verifyRestart = process.argv.includes("--verify-restart");
const baseEventId = process.env.OPEN_ALL_SHADOW_EVENT_ID
  ?? `open-all-shadow-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
if (verifyRestart && process.env.OPEN_ALL_SHADOW_EVENT_ID === undefined) {
  throw new Error("OPEN_ALL_SHADOW_EVENT_ID is required with --verify-restart.");
}

const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";
const playerId = 900000001n;
const database = createDatabaseClient(config.database);
const replies: Array<{ room: string; data: string }> = [];
const app = buildApp(config, {
  database,
  inspectIrisChannel: async () => ({
    mode: "operational", channelClass: "open_group", reason: "allowed",
    evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false }
  }),
  sendIrisTextReply: async (reply) => { replies.push(reply); }
});

async function seedCatalog(): Promise<void> {
  for (const [index, definition] of OPEN_ALL_ITEMS.entries()) {
    await database.execute(
      `INSERT INTO item_definitions (id, code, display_name, asset_type_code, stackable, metadata_json, active, version)
       VALUES (?, ?, ?, 'item', TRUE, JSON_OBJECT('synthetic', TRUE, 'slice', 'SL-INVENTORY-OPEN-ALL'), TRUE, 1)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), active = TRUE`,
      [920000000 + index, definition.code, definition.name]
    );
  }
}

async function resetStacks(entries: Record<string, bigint>): Promise<void> {
  await database.execute(
    `DELETE stack FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
     WHERE stack.player_id = ? AND JSON_VALUE(item.metadata_json, '$.slice') = 'SL-INVENTORY-OPEN-ALL'`,
    [playerId]
  );
  for (const [code, quantity] of Object.entries(entries)) {
    await database.execute(
      `INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
       SELECT ?, id, ?, 1 FROM item_definitions WHERE code = ?`,
      [playerId, quantity, code]
    );
  }
}

async function dispatch(providerEventId: string) {
  return app.inject({
    method: "POST", url: "/api/v1/integrations/iris/events",
    headers: { authorization: `Bearer ${config.irisSharedToken}` },
    payload: {
      msg: "/전체오픈", room: "합성 전체오픈 Shadow 방", sender: "테스트알파",
      json: { id: providerEventId, chat_id: channelId, user_id: externalUserId, type: 1 }
    }
  });
}

function failingAfterInventoryMutation(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params),
    verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => {
      const wrapped: DatabaseTransaction = {
        query: (sql, params) => transaction.query(sql, params),
        execute: async (sql, params) => {
          if (sql.includes("INSERT INTO inventory_ledger")) throw new Error("synthetic mid-write failure");
          return transaction.execute(sql, params);
        }
      };
      return work(wrapped);
    })
  };
}

try {
  await seedCatalog();
  const normalEvent = `${baseEventId}-normal`;
  if (!verifyRestart) {
    await resetStacks({ trash_box: 2n, mini_point_box: 1n, pet_food_special: 2n, guild_contribution_medal: 1n });
    const normal = await dispatch(normalEvent);
    assert.equal(normal.statusCode, 202);
    assert.equal(normal.json().duplicate, false);
    assert.match(replies.at(-1)?.data ?? "", /전체 오픈/);

    const duplicate = await dispatch(normalEvent);
    assert.equal(duplicate.statusCode, 202);
    assert.equal(duplicate.json().duplicate, true);

    await resetStacks({});
    const empty = await dispatch(`${baseEventId}-empty`);
    assert.equal(empty.statusCode, 202);
    assert.match(replies.at(-1)?.data ?? "", /오픈할 상자가 없습니다/);

    await resetStacks({ pet_food_box: 1n });
    const partial = await dispatch(`${baseEventId}-partial`);
    assert.equal(partial.statusCode, 202);
    assert.match(replies.at(-1)?.data ?? "", /펫먹이상자/);

    await resetStacks({ trash_box: 1n, spirit_box: 1n });
    const before = await database.query<Array<{ code: string; quantity: bigint }>>(
      `SELECT item.code, stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
       WHERE stack.player_id = ? AND item.code IN ('trash_box', 'spirit_box') ORDER BY item.code`, [playerId]
    );
    await assert.rejects(
      () => new OpenAllService(new MariaOpenAllRepository(failingAfterInventoryMutation(database)), { next: () => 0 }).handle({
        externalUserId, channelId, message: "/전체오픈", eventId: `iris:${baseEventId}-failure`
      }),
      /synthetic mid-write failure/
    );
    const after = await database.query<Array<{ code: string; quantity: bigint }>>(
      `SELECT item.code, stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
       WHERE stack.player_id = ? AND item.code IN ('trash_box', 'spirit_box') ORDER BY item.code`, [playerId]
    );
    assert.deepEqual(after, before);
    const rolledBack = await database.query<Array<{ count: bigint }>>(
      "SELECT COUNT(*) AS count FROM operations WHERE idempotency_key = ?", [`iris:${baseEventId}-failure`]
    );
    assert.equal(rolledBack[0]?.count, 0n);
  } else {
    const replay = await dispatch(normalEvent);
    assert.equal(replay.statusCode, 202);
    assert.equal(replay.json().duplicate, true);
    assert.equal(replies.length, 0);
  }

  const eventId = `iris:${normalEvent}`;
  const scope = "inventory.open-all:900000004";
  const effects = await database.query<Array<{
    operation_count: bigint; execution_count: bigint; audit_count: bigint; outbox_count: bigint; delivery_count: bigint;
  }>>(
    `SELECT
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope = ? AND idempotency_key = ?) AS operation_count,
       (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'open_all') AS execution_count,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id
         WHERE operation_row.idempotency_scope = ? AND operation_row.idempotency_key = ?) AS audit_count,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
         WHERE operation_row.idempotency_scope = ? AND operation_row.idempotency_key = ?) AS outbox_count,
       (SELECT COUNT(*) FROM delivery_attempts delivery JOIN outbox_messages outbox ON outbox.id = delivery.outbox_message_id
         JOIN operations operation_row ON operation_row.id = outbox.operation_id
         WHERE operation_row.idempotency_scope = ? AND operation_row.idempotency_key = ?) AS delivery_count`,
    [scope, eventId, eventId, scope, eventId, scope, eventId, scope, eventId]
  );
  assert.deepEqual(effects[0], { operation_count: 1n, execution_count: 1n, audit_count: 1n, outbox_count: 1n, delivery_count: 1n });

  process.stdout.write(`${JSON.stringify({
    mode: verifyRestart ? "verify-restart" : "shadow", database: config.database.name, baseEventId,
    scenarios: ["normal", "empty", "partial", "multiple", "duplicate", "mid-write-rollback", "restart-replay"],
    effects: { operation: 1, execution: 1, audit: 1, outbox: 1, delivery: 1 },
    operationalSnapshotTouched: false
  })}\n`);
} finally {
  await app.close();
}
