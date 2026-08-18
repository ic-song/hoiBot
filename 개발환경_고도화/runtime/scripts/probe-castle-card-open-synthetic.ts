import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { recordOutboxDelivery } from "../src/integration/event-processing-service.js";
import { OutboxWorker } from "../src/integration/outbox-worker.js";
import { CASTLE_CARD_CONSUMER, CASTLE_CARD_REWARDS, type CastleCardRandomSource } from "../src/inventory/castle-card-open-policy.js";
import { CastleCardOpenService, type CastleCardOpenCommand } from "../src/inventory/castle-card-open-service.js";
import { MariaCastleCardOpenRepository } from "../src/inventory/maria-castle-card-open-repository.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic castle-card probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const playerId = 900000001n;
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";
const prefix = "castle-card-open-79d31f-v1";
const prepare = process.argv.includes("--prepare");
const allCodes = [CASTLE_CARD_CONSUMER.code, ...CASTLE_CARD_REWARDS.map(({ code }) => code)];

function command(message: string, suffix: string): CastleCardOpenCommand {
  return { externalUserId, channelId, message, eventId: `${prefix}-${suffix}` };
}

function sequence(values: number[]): CastleCardRandomSource {
  let index = 0;
  return { next() { const value = values[index++]; if (value === undefined) throw new Error("synthetic RNG exhausted"); return value; } };
}

async function ensureEvent(value: CastleCardOpenCommand): Promise<void> {
  await database.execute(
    `INSERT INTO event_inbox
     (event_id, provider_code, provider_event_id, external_channel_id, channel_id,
      external_user_id, external_identity_id, event_kind, event_origin, direction,
      payload_hash, parse_status, processing_status, received_at)
     VALUES (?, 'iris', ?, ?, 900000001, ?, 900000004, 'message', 'synthetic_probe', 'incoming',
       REPEAT('0', 64), 'parsed', 'processed', UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE processing_status = VALUES(processing_status)`,
    [value.eventId, value.eventId, channelId, externalUserId]
  );
}

async function seed(consumerQuantity: bigint | null, rewardQuantities: Record<string, bigint> = {}): Promise<void> {
  await database.withTransaction(async (tx) => {
    const placeholders = allCodes.map(() => "?").join(", ");
    await tx.execute(
      `DELETE stack FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
       WHERE stack.player_id = ? AND item.code IN (${placeholders})`, [playerId, ...allCodes]
    );
    if (consumerQuantity !== null) await tx.execute(
      `INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
       SELECT ?, id, ?, 1 FROM item_definitions WHERE code = ?`,
      [playerId, consumerQuantity, CASTLE_CARD_CONSUMER.code]
    );
    for (const [code, quantity] of Object.entries(rewardQuantities)) {
      await tx.execute(
        `INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
         SELECT ?, id, ?, 1 FROM item_definitions WHERE code = ?`, [playerId, quantity, code]
      );
    }
  });
}

async function quantities(): Promise<Record<string, bigint>> {
  const rows = await database.query<Array<{ code: string; quantity: bigint }>>(
    `SELECT item.code, stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
     WHERE stack.player_id = ? AND item.code IN (${allCodes.map(() => "?").join(", ")})`, [playerId, ...allCodes]
  );
  return Object.fromEntries(rows.map((row) => [row.code, row.quantity]));
}

function failpointClient(base: DatabaseClient, sqlFragment: string, occurrence = 1): DatabaseClient {
  let seen = 0;
  return {
    ping: () => base.ping(), verifyRollback: () => base.verifyRollback(),
    query: (statement, values) => base.query(statement, values),
    execute: (statement, values) => base.execute(statement, values), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => base.withTransaction(async (transaction) => {
      const proxy: DatabaseTransaction = {
        query: (statement, values) => transaction.query(statement, values),
        execute: async (statement, values) => {
          const result = await transaction.execute(statement, values);
          if (statement.includes(sqlFragment) && ++seen === occurrence) {
            throw new Error(`synthetic failpoint:${sqlFragment}:${occurrence}`);
          }
          return result;
        }
      };
      return work(proxy);
    })
  };
}

async function run(value: CastleCardOpenCommand, randomFactory?: (seed: string) => CastleCardRandomSource,
  client: DatabaseClient = database) {
  await ensureEvent(value);
  return new CastleCardOpenService(new MariaCastleCardOpenRepository(client), randomFactory).handle(value);
}

async function operationCount(eventId: string): Promise<bigint> {
  const rows = await database.query<Array<{ value: bigint }>>(
    "SELECT COUNT(*) AS value FROM command_executions WHERE event_id = ?", [eventId]
  );
  return rows[0]?.value ?? -1n;
}

async function cleanup(): Promise<void> {
  await database.withTransaction(async (tx) => {
    const match = `${prefix}%`;
    await tx.execute("DELETE attempt FROM delivery_attempts attempt JOIN outbox_messages outbox ON outbox.id = attempt.outbox_message_id JOIN operations operation_row ON operation_row.id = outbox.operation_id WHERE operation_row.idempotency_key LIKE ?", [match]);
    await tx.execute("DELETE outbox FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id WHERE operation_row.idempotency_key LIKE ?", [match]);
    await tx.execute("DELETE audit FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id WHERE operation_row.idempotency_key LIKE ?", [match]);
    await tx.execute("DELETE FROM command_executions WHERE event_id LIKE ?", [match]);
    await tx.execute("DELETE ledger FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id WHERE operation_row.idempotency_key LIKE ?", [match]);
    await tx.execute("DELETE FROM operations WHERE idempotency_scope LIKE 'inventory.castle-card-open:%' AND idempotency_key LIKE ?", [match]);
    await tx.execute("DELETE FROM event_inbox WHERE event_id LIKE ?", [match]);
  });
}

try {
  if (prepare) {
    await cleanup();
    const catalog = await database.query<Array<{ code: string }>>(
      `SELECT code FROM item_definitions WHERE code IN (${allCodes.map(() => "?").join(", ")}) ORDER BY code`, allCodes
    );
    assert.deepEqual(catalog.map(({ code }) => code), [...allCodes].sort());

    await seed(3n);
    const one = await run(command("/카드오픈", "one"), () => sequence([0.5]));
    assert.equal(one.status, "opened");
    assert.equal("openCount" in one && one.openCount, 1);
    assert.equal((await quantities()).trash_box, 1n);
    const duplicate = await run(command("/카드오픈", "one"), () => { throw new Error("duplicate RNG must not run"); });
    assert.equal("duplicate" in duplicate && duplicate.duplicate, true);

    await seed(9n, { pet_food: 0n, castle_myth_unit: 2n });
    const boundaryValues = [0, 0.0003, 0.001, 0.004, 0.014, 0.044, 0.114, 0.164, 0.314];
    const boundary = await run(command("/카드오픈 9", "boundaries"), () => sequence(boundaryValues));
    assert.equal(boundary.status, "opened");
    if (boundary.status !== "opened") throw new Error("boundary probe did not open");
    assert.deepEqual(boundary.rngTrace.map(({ rewardCode }) => rewardCode), allCodes.slice(1));
    assert.equal((await quantities()).pet_food, 4n);
    assert.deepEqual(boundary.aggregates.map(({ rewardCode }) => rewardCode), allCodes.slice(1));

    await seed(4n);
    const ordered = await run(command("/카드오픈 4", "order"), () => sequence([0.0004, 0, 0.0002, 0.2]));
    assert.equal(ordered.status, "opened");
    if (ordered.status !== "opened") throw new Error("order probe did not open");
    assert.deepEqual(ordered.aggregates.map(({ rewardCode, quantity }) => `${rewardCode}:${quantity}`), [
      "castle_myth_unit:1", "castle_immortal_unit:2", "pet_food_box:1"
    ]);
    assert.equal(ordered.delayedOutboxIds.length, 4);

    for (const [suffix, consumerQuantity] of [["missing", null], ["zero", 0n]] as const) {
      await seed(consumerQuantity);
      const result = await run(command("/카드오픈", suffix));
      assert.equal(result.status, "consumer_required");
      assert.match("data" in result ? result.data ?? "" : "", /캐슬카드🃏이 부족합니다/);
    }
    const unregistered = await new CastleCardOpenService(new MariaCastleCardOpenRepository(database)).handle({
      externalUserId: "synthetic-unregistered", channelId, message: "/카드오픈", eventId: `${prefix}-unregistered`
    });
    assert.equal(unregistered.status, "ignored_unregistered");
    await database.execute("UPDATE castle_battle_seasons SET starts_at = UTC_TIMESTAMP(3), ends_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 DAY) WHERE id = 900000001");
    try {
      await seed(1n);
      assert.equal((await run(command("/카드오픈", "castle"))).status, "blocked_by_castle_siege");
    } finally {
      await database.execute("UPDATE castle_battle_seasons SET starts_at = '2026-01-01 00:00:00.000', ends_at = '2026-01-31 23:59:59.000' WHERE id = 900000001");
    }

    await seed(1n);
    const concurrent = await Promise.all([
      run(command("/카드오픈", "concurrent-a"), () => sequence([0.2])),
      run(command("/카드오픈", "concurrent-b"), () => sequence([0.2]))
    ]);
    assert.deepEqual(concurrent.map(({ status }) => status).sort(), ["consumer_required", "opened"]);

    const failpoints = [
      { sql: "INSERT INTO operations", occurrence: 1 },
      { sql: "UPDATE inventory_stacks SET quantity", occurrence: 1 },
      { sql: "INSERT INTO inventory_stacks", occurrence: 1 },
      { sql: "INSERT INTO inventory_ledger", occurrence: 1 },
      { sql: "INSERT INTO outbox_messages", occurrence: 1 },
      { sql: "INSERT INTO outbox_messages", occurrence: 2 },
      { sql: "INSERT INTO command_executions", occurrence: 1 },
      { sql: "INSERT INTO command_audit", occurrence: 1 },
      { sql: "UPDATE operations SET status", occurrence: 1 }
    ];
    for (let index = 0; index < failpoints.length; index += 1) {
      const failpoint = failpoints[index]!;
      await seed(2n, failpoint.sql === "INSERT INTO inventory_stacks" ? {} : { trash_box: 0n });
      const value = command("/카드오픈", `fail-${index}`);
      const before = await quantities();
      await assert.rejects(() => run(value, () => sequence([0.5]), failpointClient(database, failpoint.sql, failpoint.occurrence)), /synthetic failpoint/);
      assert.deepEqual(await quantities(), before);
      assert.equal(await operationCount(value.eventId), 0n);
    }

    await seed(2n);
    const retryCommand = command("/카드오픈 2", "rollback-retry");
    await assert.rejects(() => run(retryCommand, () => sequence([0, 0.0004]), failpointClient(database, "INSERT INTO command_audit")), /synthetic failpoint/);
    const retry = await run(retryCommand, () => sequence([0, 0.0004]));
    assert.equal(retry.status, "opened");
    if (retry.status !== "opened") throw new Error("retry probe did not open");
    assert.deepEqual(retry.rngTrace.map(({ rewardCode }) => rewardCode), ["castle_immortal_unit", "castle_myth_unit"]);

    await database.execute(
      `UPDATE outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
       SET outbox.status = 'sent', outbox.sent_at = UTC_TIMESTAMP(3)
       WHERE operation_row.idempotency_key LIKE ? AND outbox.status = 'pending'`, [`${prefix}%`]
    );
    await seed(2n);
    const restart = await run(command("/카드오픈 2", "restart"), () => sequence([0, 0.0004]));
    assert.equal(restart.status, "opened");
    if (restart.status !== "opened") throw new Error("restart probe did not open");
    await recordOutboxDelivery(database, restart.immediateOutboxId, { ok: true });
    const pending = await database.query<Array<{ status: string; value: bigint }>>(
      `SELECT status, COUNT(*) AS value FROM outbox_messages WHERE id IN (${restart.delayedOutboxIds.map(() => "?").join(", ")}) GROUP BY status`,
      restart.delayedOutboxIds
    );
    assert.deepEqual(pending, [{ status: "pending", value: 3n }]);
  } else {
    const delivered: string[] = [];
    const worker = new OutboxWorker(database, async ({ data }) => { delivered.push(data); });
    const count = await worker.runOnce(20);
    assert.equal(count, 3);
    assert.match(delivered[0] ?? "", /보상 결과/);
    assert.match(delivered[1] ?? "", /불멸유닛 등장/);
    assert.match(delivered[2] ?? "", /신화급 유닛 등장/);
    assert.equal(await worker.runOnce(20), 0);
    const replay = await run(command("/카드오픈 2", "restart"), () => { throw new Error("restart replay RNG must not run"); });
    assert.equal("duplicate" in replay && replay.duplicate, true);
    const attempts = await database.query<Array<{ value: bigint }>>(
      `SELECT COUNT(*) AS value FROM delivery_attempts attempt JOIN outbox_messages outbox ON outbox.id = attempt.outbox_message_id
       JOIN operations operation_row ON operation_row.id = outbox.operation_id WHERE operation_row.idempotency_key = ?`,
      [`${prefix}-restart`]
    );
    assert.equal(attempts[0]?.value, 4n);
  }

  const effects = await database.query<Array<{ operations: bigint; executions: bigint; audits: bigint; outboxes: bigint; ledgers: bigint }>>(
    `SELECT
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'inventory.castle-card-open:%' AND idempotency_key LIKE ?) AS operations,
       (SELECT COUNT(*) FROM command_executions WHERE event_id LIKE ?) AS executions,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id WHERE operation_row.idempotency_key LIKE ?) AS audits,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id WHERE operation_row.idempotency_key LIKE ?) AS outboxes,
       (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id WHERE operation_row.idempotency_key LIKE ?) AS ledgers`,
    [`${prefix}%`, `${prefix}%`, `${prefix}%`, `${prefix}%`, `${prefix}%`]
  );
  assert.equal(effects[0]?.operations, effects[0]?.executions);
  assert.equal(effects[0]?.operations, effects[0]?.audits);
  process.stdout.write(`${JSON.stringify({
    database: config.database.name, prepare, rawParity: true, thresholdEqualityNextBranch: true,
    quantityFour: true, firstAppearanceAggregation: true, specialNoticeOrder: true,
    consumerKeyMismatchPreserved: true, zeroConsumerStackDeleted: true, undefinedRewardStackInserted: true,
    concurrentLockedRemaining: true, failpointRollbackCount: 9, deterministicRollbackRetry: true,
    delayedOutboxRestartReplayOnce: !prepare, effects: effects[0], migrationAdded: false,
    operationalSnapshotTouched: false, operationalDatabaseTouched: false
  }, (_key, value) => typeof value === "bigint" ? value.toString() : value)}\n`);
} finally {
  await database.close();
}
