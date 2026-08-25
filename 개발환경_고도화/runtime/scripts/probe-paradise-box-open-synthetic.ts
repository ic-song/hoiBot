import assert from "node:assert/strict";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { ParadiseBoxOpenService } from "../src/inventory/paradise-box-open-service.js";
import { MariaParadiseBoxOpenRepository } from "../src/inventory/maria-paradise-box-open-repository.js";

const database = createDatabaseClient({
  enabled: true, host: process.env.DB_HOST ?? "127.0.0.1", port: Number(process.env.DB_PORT ?? "13307"),
  user: process.env.DB_USER ?? "root", password: process.env.DB_PASSWORD ?? "", name: process.env.DB_NAME ?? "hoibot",
  connectionLimit: 4, connectTimeoutMs: 5000
});
const playerId = 900000001n;
let itemId = 0n;
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";

async function seedDefinition(): Promise<void> {
  await database.execute(
    `INSERT INTO item_definitions (code, display_name, asset_type_code, stackable, metadata_json, active, version)
     VALUES ('paradise_point_box', '극락상자👹', 'item', TRUE, JSON_OBJECT('synthetic', TRUE), TRUE, 1)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), active = TRUE`
  );
  const definitions = await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code = 'paradise_point_box'");
  if (definitions[0] === undefined) throw new Error("synthetic paradise item definition missing");
  itemId = definitions[0].id;
}

async function setState(boxes: bigint, points: bigint): Promise<void> {
  await database.execute("DELETE FROM inventory_stacks WHERE player_id = ? AND item_id = ?", [playerId, itemId]);
  if (boxes > 0n) await database.execute("INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, ?, 1)", [playerId, itemId, boxes]);
  await database.execute(
    "INSERT INTO currency_accounts (player_id, currency_code, balance, version) VALUES (?, 'point', ?, 1) ON DUPLICATE KEY UPDATE balance = VALUES(balance), version = version + 1",
    [playerId, points]
  );
}

async function seedEvent(eventId: string): Promise<void> {
  await database.execute(
    "INSERT IGNORE INTO event_inbox (event_id, event_kind, processing_status, received_at) VALUES (?, 'message', 'processing', UTC_TIMESTAMP(3))",
    [eventId]
  );
}

function failingAfterPointWrite(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), verifyRollback: () => inner.verifyRollback(), query: (sql, values) => inner.query(sql, values),
    execute: (sql, values) => inner.execute(sql, values), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, values) => transaction.query(sql, values),
      execute: async (sql, values) => {
        if (sql.includes("INSERT INTO currency_ledger")) throw new Error("synthetic mid-write failure");
        return transaction.execute(sql, values);
      }
    }))
  };
}

try {
  await seedDefinition();
  await setState(3n, 1_000_000n);
  const normalEvent = "paradise-box-probe-normal";
  await seedEvent(normalEvent);
  let drawIndex = 0;
  const service = new ParadiseBoxOpenService(new MariaParadiseBoxOpenRepository(database), { next: () => [0, 1][drawIndex++]! });
  const first = await service.handle({ externalUserId, channelId, message: "/극락오픈 2", eventId: normalEvent });
  const replay = await service.handle({ externalUserId, channelId, message: "/극락오픈 2", eventId: normalEvent });
  assert.equal(first.status, "opened"); assert.equal(replay.status, "opened");
  if (first.status !== "opened" || replay.status !== "opened") throw new Error("unexpected ignored result");
  assert.deepEqual(first.drawPoints, ["1000000", "10000000"]); assert.equal(first.totalPoint, "11000000");
  assert.equal(first.balanceAfter, "12000000"); assert.equal(replay.duplicate, true); assert.equal(drawIndex, 2);
  const normalEffects = await database.query<Array<{ boxes: bigint; points: string; operations: bigint; executions: bigint; draws: bigint; inventory_ledgers: bigint; currency_ledgers: bigint; grants: bigint; audits: bigint; outbox: bigint }>>(
    `SELECT
       (SELECT quantity FROM inventory_stacks WHERE player_id = ? AND item_id = ?) AS boxes,
       (SELECT CAST(balance AS CHAR) FROM currency_accounts WHERE player_id = ? AND currency_code = 'point') AS points,
       (SELECT COUNT(*) FROM operations WHERE idempotency_key = ?) AS operations,
       (SELECT COUNT(*) FROM paradise_box_open_executions execution JOIN operations operation_row ON operation_row.id = execution.operation_id WHERE operation_row.idempotency_key = ?) AS executions,
       (SELECT COUNT(*) FROM paradise_box_open_draws draw JOIN operations operation_row ON operation_row.id = draw.operation_id WHERE operation_row.idempotency_key = ?) AS draws,
       (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id WHERE operation_row.idempotency_key = ?) AS inventory_ledgers,
       (SELECT COUNT(*) FROM currency_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id WHERE operation_row.idempotency_key = ?) AS currency_ledgers,
       (SELECT COUNT(*) FROM paradise_box_open_grants grant_row JOIN operations operation_row ON operation_row.id = grant_row.operation_id WHERE operation_row.idempotency_key = ?) AS grants,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id WHERE operation_row.idempotency_key = ?) AS audits,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id WHERE operation_row.idempotency_key = ?) AS outbox`,
    [playerId, itemId, playerId, normalEvent, normalEvent, normalEvent, normalEvent, normalEvent, normalEvent, normalEvent, normalEvent]
  );
  assert.deepEqual(normalEffects[0], { boxes: 1n, points: "12000000.000", operations: 1n, executions: 1n, draws: 2n, inventory_ledgers: 1n, currency_ledgers: 1n, grants: 1n, audits: 1n, outbox: 1n });

  const boundedEvent = "paradise-box-probe-bounded";
  await seedEvent(boundedEvent); await setState(1n, 0n);
  const bounded = await new ParadiseBoxOpenService(new MariaParadiseBoxOpenRepository(database), { next: () => 0.5 }).handle(
    { externalUserId, channelId, message: "/극락오픈 5", eventId: boundedEvent }
  );
  assert.equal(bounded.status, "opened");
  if (bounded.status === "opened") assert.equal(bounded.openedCount, "1");

  const concurrentEvent = "paradise-box-probe-concurrent";
  await seedEvent(concurrentEvent); await setState(2n, 0n);
  let concurrentDraws = 0;
  const concurrent = await Promise.all([
    new ParadiseBoxOpenService(new MariaParadiseBoxOpenRepository(database), { next: () => { concurrentDraws++; return 0; } }).handle(
      { externalUserId, channelId, message: "/극락오픈 2", eventId: concurrentEvent }
    ),
    new ParadiseBoxOpenService(new MariaParadiseBoxOpenRepository(database), { next: () => { concurrentDraws++; return 1; } }).handle(
      { externalUserId, channelId, message: "/극락오픈 2", eventId: concurrentEvent }
    )
  ]);
  assert.equal(concurrent.filter((result) => result.status === "opened" && result.duplicate).length, 1);
  assert.equal(concurrentDraws, 2);

  const failureEvent = "paradise-box-probe-rollback";
  await seedEvent(failureEvent); await setState(2n, 3_000_000n);
  await assert.rejects(
    () => new ParadiseBoxOpenService(new MariaParadiseBoxOpenRepository(failingAfterPointWrite(database)), { next: () => 0 }).handle(
      { externalUserId, channelId, message: "/극락오픈 1", eventId: failureEvent }
    ), /synthetic mid-write failure/
  );
  const rollback = await database.query<Array<{ boxes: bigint; points: string; operations: bigint }>>(
    `SELECT
       (SELECT quantity FROM inventory_stacks WHERE player_id = ? AND item_id = ?) AS boxes,
       (SELECT CAST(balance AS CHAR) FROM currency_accounts WHERE player_id = ? AND currency_code = 'point') AS points,
       (SELECT COUNT(*) FROM operations WHERE idempotency_key = ?) AS operations`,
    [playerId, itemId, playerId, failureEvent]
  );
  assert.deepEqual(rollback[0], { boxes: 2n, points: "3000000.000", operations: 0n });

  await assert.rejects(
    () => new ParadiseBoxOpenService(new MariaParadiseBoxOpenRepository(database), { next: () => 0 }).handle(
      { externalUserId: "synthetic-missing-user", channelId, message: "/극락오픈", eventId: "paradise-box-probe-unregistered" }
    ), (error) => error instanceof Error && "code" in error && error.code === "PARADISE_BOX_OPEN_ACTOR_REQUIRED"
  );

  process.stdout.write(`${JSON.stringify({ scenarios: ["inclusive-rng", "duplicate-replay", "owned-quantity-bound", "same-event-concurrency", "mid-write-rollback", "unregistered"], normalEffects: normalEffects[0], rollback: true }, (_key, value) => typeof value === "bigint" ? value.toString() : value)}\n`);
} finally {
  await database.close();
}
