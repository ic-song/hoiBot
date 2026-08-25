import assert from "node:assert/strict";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { EnhanceBoxOpenService } from "../src/inventory/enhance-box-open-service.js";
import { MariaEnhanceBoxOpenRepository } from "../src/inventory/maria-enhance-box-open-repository.js";

const database = createDatabaseClient({
  enabled: true, host: process.env.DB_HOST ?? "127.0.0.1", port: Number(process.env.DB_PORT ?? "13307"),
  user: process.env.DB_USER ?? "root", password: process.env.DB_PASSWORD ?? "", name: process.env.DB_NAME ?? "hoibot",
  connectionLimit: 4, connectTimeoutMs: 5000
});
const playerId = 900000001n;
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";

async function seedItems(): Promise<void> {
  await database.execute(
    `INSERT INTO item_definitions (id, code, display_name, asset_type_code, stackable, metadata_json, active, version)
     VALUES (927000001, 'enhance_dungeon_box', '강화박스⭐(/강화박스오픈)', 'item', TRUE, JSON_OBJECT('synthetic', TRUE), TRUE, 1),
            (927000002, 'pet_enhance_stone', '펫 강화석⭐', 'item', TRUE, JSON_OBJECT('synthetic', TRUE), TRUE, 1)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), active = TRUE`
  );
}

async function setStacks(boxes: bigint, rewards: bigint): Promise<void> {
  await database.execute("DELETE FROM inventory_stacks WHERE player_id = ? AND item_id IN (927000001, 927000002)", [playerId]);
  if (boxes > 0n) await database.execute("INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, 927000001, ?, 1)", [playerId, boxes]);
  if (rewards > 0n) await database.execute("INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, 927000002, ?, 1)", [playerId, rewards]);
}

async function seedEvent(eventId: string): Promise<void> {
  await database.execute(
    "INSERT IGNORE INTO event_inbox (event_id, event_kind, processing_status, received_at) VALUES (?, 'message', 'processing', UTC_TIMESTAMP(3))",
    [eventId]
  );
}

function failingAfterFirstLedger(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), verifyRollback: () => inner.verifyRollback(), query: (sql, values) => inner.query(sql, values),
    execute: (sql, values) => inner.execute(sql, values), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, values) => transaction.query(sql, values),
      execute: async (sql, values) => {
        if (sql.includes("INSERT INTO inventory_ledger") && sql.includes("sequence_no")) throw new Error("synthetic mid-write failure");
        return transaction.execute(sql, values);
      }
    }))
  };
}

try {
  await seedItems();
  await setStacks(3n, 5n);
  const eventId = "enhance-box-probe-normal";
  await seedEvent(eventId);
  let drawIndex = 0;
  const service = new EnhanceBoxOpenService(new MariaEnhanceBoxOpenRepository(database), { next: () => [0, 1][drawIndex++]! });
  const first = await service.handle({ externalUserId, channelId, message: "/강화박스오픈 2", eventId });
  const replay = await service.handle({ externalUserId, channelId, message: "/강화박스오픈 2", eventId });
  assert.equal(first.status, "opened"); assert.equal(replay.status, "opened");
  if (first.status !== "opened" || replay.status !== "opened") throw new Error("unexpected ignored result");
  assert.deepEqual(first.drawRewards, [70, 100]); assert.equal(first.totalReward, "170");
  assert.equal(replay.duplicate, true); assert.equal(drawIndex, 2);

  const boundedEvent = "enhance-box-probe-bounded";
  await seedEvent(boundedEvent); await setStacks(1n, 0n);
  const bounded = await new EnhanceBoxOpenService(new MariaEnhanceBoxOpenRepository(database), { next: () => 0.5 }).handle(
    { externalUserId, channelId, message: "/강화박스오픈 5", eventId: boundedEvent }
  );
  assert.equal(bounded.status, "opened");
  if (bounded.status === "opened") assert.equal(bounded.openedCount, "1");

  const failureEvent = "enhance-box-probe-rollback";
  await seedEvent(failureEvent); await setStacks(2n, 3n);
  await assert.rejects(
    () => new EnhanceBoxOpenService(new MariaEnhanceBoxOpenRepository(failingAfterFirstLedger(database)), { next: () => 0 }).handle(
      { externalUserId, channelId, message: "/강화박스오픈 1", eventId: failureEvent }
    ), /synthetic mid-write failure/
  );
  const rollback = await database.query<Array<{ boxes: bigint; rewards: bigint; operations: bigint }>>(
    `SELECT
       (SELECT quantity FROM inventory_stacks WHERE player_id = ? AND item_id = 927000001) AS boxes,
       (SELECT quantity FROM inventory_stacks WHERE player_id = ? AND item_id = 927000002) AS rewards,
       (SELECT COUNT(*) FROM operations WHERE idempotency_key = ?) AS operations`,
    [playerId, playerId, failureEvent]
  );
  assert.deepEqual(rollback[0], { boxes: 2n, rewards: 3n, operations: 0n });
  process.stdout.write(`${JSON.stringify({ scenarios: ["inclusive-rng", "duplicate-replay", "owned-quantity-bound", "mid-write-rollback"], first, rollback: true })}\n`);
} finally {
  await database.close();
}
