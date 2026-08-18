import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { fixedRangeRandom, type FixedRangeRandomSource } from "../src/inventory/fixed-range-box-open-policy.js";
import { FixedRangeBoxOpenService, type FixedRangeBoxOpenCommand } from "../src/inventory/fixed-range-box-open-service.js";
import { MariaFixedRangeBoxOpenRepository } from "../src/inventory/maria-fixed-range-box-open-repository.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic fixed-range box probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const playerId = 900000001n;
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";
const prefix = "fixed-range-box-open-44cb69-v1";
const prepare = process.argv.includes("--prepare");

function command(message: string, suffix: string): FixedRangeBoxOpenCommand {
  return { externalUserId, channelId, message, eventId: `${prefix}-${suffix}` };
}

function sequence(values: number[]): FixedRangeRandomSource {
  let index = 0;
  return { next() { const value = values[index++]; if (value === undefined) throw new Error("synthetic RNG exhausted"); return value; } };
}

async function ensureEvent(value: FixedRangeBoxOpenCommand): Promise<void> {
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

async function seed(boxCode: string, rewardCode: string, boxQuantity: bigint | null, rewardQuantity: bigint | null): Promise<void> {
  await database.withTransaction(async (tx) => {
    await tx.execute(
      `DELETE stack FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
       WHERE stack.player_id = ? AND item.code IN (?, ?)`, [playerId, boxCode, rewardCode]
    );
    if (boxQuantity !== null) await tx.execute(
      `INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
       SELECT ?, id, ?, 1 FROM item_definitions WHERE code = ?`, [playerId, boxQuantity, boxCode]
    );
    if (rewardQuantity !== null) await tx.execute(
      `INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
       SELECT ?, id, ?, 1 FROM item_definitions WHERE code = ?`, [playerId, rewardQuantity, rewardCode]
    );
  });
}

async function quantities(boxCode: string, rewardCode: string): Promise<Record<string, bigint>> {
  const rows = await database.query<Array<{ code: string; quantity: bigint }>>(
    `SELECT item.code, stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
     WHERE stack.player_id = ? AND item.code IN (?, ?)`, [playerId, boxCode, rewardCode]
  );
  return Object.fromEntries(rows.map((row) => [row.code, row.quantity]));
}

function failpointClient(base: DatabaseClient, sqlFragment: string): DatabaseClient {
  let armed = true;
  return {
    ping: () => base.ping(), verifyRollback: () => base.verifyRollback(),
    query: (statement, values) => base.query(statement, values),
    execute: (statement, values) => base.execute(statement, values),
    close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => base.withTransaction(async (transaction) => {
      const proxy: DatabaseTransaction = {
        query: (statement, values) => transaction.query(statement, values),
        execute: async (statement, values) => {
          const result = await transaction.execute(statement, values);
          if (armed && statement.includes(sqlFragment)) {
            armed = false;
            throw new Error(`synthetic failpoint:${sqlFragment}`);
          }
          return result;
        }
      };
      return work(proxy);
    })
  };
}

async function run(value: FixedRangeBoxOpenCommand, randomFactory: (seed: string) => FixedRangeRandomSource = fixedRangeRandom,
  client: DatabaseClient = database) {
  await ensureEvent(value);
  return new FixedRangeBoxOpenService(new MariaFixedRangeBoxOpenRepository(client), randomFactory).handle(value);
}

async function operationCount(eventId: string): Promise<bigint> {
  const rows = await database.query<Array<{ value: bigint }>>(
    "SELECT COUNT(*) AS value FROM command_executions WHERE event_id = ?", [eventId]
  );
  return rows[0]?.value ?? -1n;
}

try {
  if (prepare) {
    await database.withTransaction(async (tx) => {
      const match = `${prefix}%`;
      await tx.execute("DELETE attempt FROM delivery_attempts attempt JOIN outbox_messages outbox ON outbox.id = attempt.outbox_message_id JOIN operations operation_row ON operation_row.id = outbox.operation_id WHERE operation_row.idempotency_key LIKE ?", [match]);
      await tx.execute("DELETE outbox FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id WHERE operation_row.idempotency_key LIKE ?", [match]);
      await tx.execute("DELETE audit FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id WHERE operation_row.idempotency_key LIKE ?", [match]);
      await tx.execute("DELETE FROM command_executions WHERE event_id LIKE ?", [match]);
      await tx.execute("DELETE ledger FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id WHERE operation_row.idempotency_key LIKE ?", [match]);
      await tx.execute("DELETE FROM operations WHERE idempotency_scope LIKE 'inventory.fixed-range-box-open:%' AND idempotency_key LIKE ?", [match]);
      await tx.execute("DELETE FROM event_inbox WHERE event_id LIKE ?", [match]);
    });
    const catalog = await database.query<Array<{ code: string }>>(
      "SELECT code FROM item_definitions WHERE code IN ('spirit_box', 'spirit_fragment', 'chicken_box', 'seasoned_chicken') ORDER BY code"
    );
    assert.deepEqual(catalog.map(({ code }) => code), ["chicken_box", "seasoned_chicken", "spirit_box", "spirit_fragment"]);

    await seed("spirit_box", "spirit_fragment", 2n, null);
    const spiritOne = await run(command("/정령오픈", "spirit-one"), () => sequence([0]));
    assert.equal(spiritOne.status, "opened");
    assert.equal("totalQuantity" in spiritOne && spiritOne.totalQuantity, "5");
    assert.deepEqual(await quantities("spirit_box", "spirit_fragment"), { spirit_box: 1n, spirit_fragment: 5n });
    const duplicate = await run(command("/정령오픈", "spirit-one"), () => { throw new Error("duplicate RNG must not run"); });
    assert.equal("duplicate" in duplicate && duplicate.duplicate, true);

    await seed("chicken_box", "seasoned_chicken", 3n, 0n);
    const chickenTwo = await run(command("/치킨오픈 2", "chicken-two"), () => sequence([1, 0]));
    assert.equal("rngTrace" in chickenTwo && chickenTwo.rngTrace.join(","), "10,5");
    assert.deepEqual(await quantities("chicken_box", "seasoned_chicken"), { chicken_box: 1n, seasoned_chicken: 15n });

    await seed("spirit_box", "spirit_fragment", 2n, null);
    const zero = await run(command("/정령오픈 0", "zero"), () => ({ next() { throw new Error("zero-open RNG must not run"); } }));
    assert.equal("effectiveOpenCount" in zero && zero.effectiveOpenCount, 0);
    assert.deepEqual(await quantities("spirit_box", "spirit_fragment"), { spirit_box: 2n, spirit_fragment: 0n });

    await seed("spirit_box", "spirit_fragment", 2n, 7n);
    const all = await run(command("/정령오픈  99", "two-spaces"), () => sequence([0, 1]));
    assert.equal("effectiveOpenCount" in all && all.effectiveOpenCount, 2);
    await seed("spirit_box", "spirit_fragment", 2n, 0n);
    const tab = await run(command("/정령오픈\t2", "tab"), () => sequence([0]));
    assert.equal("effectiveOpenCount" in tab && tab.effectiveOpenCount, 1);

    for (const [suffix, boxQuantity, expectedStatus] of [
      ["missing-box", null, "box_required"], ["zero-box", 0n, "box_required"]
    ] as const) {
      await seed("spirit_box", "spirit_fragment", boxQuantity, null);
      const result = await run(command("/정령오픈", suffix));
      assert.equal(result.status, expectedStatus);
    }

    const unregistered = await new FixedRangeBoxOpenService(new MariaFixedRangeBoxOpenRepository(database)).handle({
      externalUserId: "synthetic-unregistered", channelId, message: "/정령오픈", eventId: `${prefix}-unregistered`
    });
    assert.equal(unregistered.status, "ignored_unregistered");
    await database.execute("UPDATE castle_battle_seasons SET starts_at = UTC_TIMESTAMP(3), ends_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 DAY) WHERE id = 900000001");
    try {
      const blocked = await run(command("/정령오픈", "castle"));
      assert.equal(blocked.status, "blocked_by_castle_siege");
    } finally {
      await database.execute("UPDATE castle_battle_seasons SET starts_at = '2026-01-01 00:00:00.000', ends_at = '2026-01-31 23:59:59.000' WHERE id = 900000001");
    }

    await seed("chicken_box", "seasoned_chicken", 2n, 0n);
    const firstCap = await run(command("/치킨오픈", "cap-a"), () => sequence([0]));
    const secondCap = await run(command("/치킨오픈 99", "cap-b"), () => sequence([0]));
    assert.equal("effectiveOpenCount" in firstCap && firstCap.effectiveOpenCount, 1);
    assert.equal("effectiveOpenCount" in secondCap && secondCap.effectiveOpenCount, 1);

    const failpoints = [
      { sql: "UPDATE inventory_stacks SET quantity", rewardQuantity: 0n },
      { sql: "INSERT INTO inventory_stacks", rewardQuantity: null },
      { sql: "INSERT INTO inventory_ledger", rewardQuantity: 0n },
      { sql: "INSERT INTO outbox_messages", rewardQuantity: 0n },
      { sql: "INSERT INTO command_audit", rewardQuantity: 0n }
    ] as const;
    for (let index = 0; index < failpoints.length; index += 1) {
      const failpoint = failpoints[index]!;
      await seed("spirit_box", "spirit_fragment", 2n, failpoint.rewardQuantity);
      const value = command("/정령오픈", `fail-${index}`);
      await ensureEvent(value);
      const before = await quantities("spirit_box", "spirit_fragment");
      await assert.rejects(() => run(value, () => sequence([0]), failpointClient(database, failpoint.sql)), /synthetic failpoint/);
      assert.deepEqual(await quantities("spirit_box", "spirit_fragment"), before);
      assert.equal(await operationCount(value.eventId), 0n);
    }

    await seed("spirit_box", "spirit_fragment", 2n, 0n);
    const retryCommand = command("/정령오픈 2", "rollback-retry");
    await ensureEvent(retryCommand);
    await assert.rejects(() => run(retryCommand, () => sequence([0, 1]), failpointClient(database, "INSERT INTO inventory_ledger")), /synthetic failpoint/);
    const retry = await run(retryCommand, () => sequence([0, 1]));
    assert.equal("rngTrace" in retry && retry.rngTrace.join(","), "5,10");

    await seed("chicken_box", "seasoned_chicken", 2n, 0n);
    const restart = await run(command("/치킨오픈 2", "restart"));
    assert.equal(restart.status, "opened");
  } else {
    const restart = await run(command("/치킨오픈 2", "restart"), () => { throw new Error("restart replay RNG must not run"); });
    assert.equal(restart.status, "opened");
    assert.equal("duplicate" in restart && restart.duplicate, true);
  }

  const effects = await database.query<Array<{ operations: bigint; executions: bigint; audits: bigint; outboxes: bigint; ledgers: bigint }>>(
    `SELECT
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'inventory.fixed-range-box-open:%' AND idempotency_key LIKE ?) AS operations,
       (SELECT COUNT(*) FROM command_executions WHERE event_id LIKE ?) AS executions,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id WHERE operation_row.idempotency_key LIKE ?) AS audits,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id WHERE operation_row.idempotency_key LIKE ?) AS outboxes,
       (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id WHERE operation_row.idempotency_key LIKE ?) AS ledgers`,
    [`${prefix}%`, `${prefix}%`, `${prefix}%`, `${prefix}%`, `${prefix}%`]
  );
  assert.ok((effects[0]?.operations ?? 0n) >= 9n);
  assert.equal(effects[0]?.operations, effects[0]?.executions);
  assert.equal(effects[0]?.operations, effects[0]?.audits);
  assert.equal(effects[0]?.operations, effects[0]?.outboxes);
  assert.equal((effects[0]?.operations ?? 0n) * 2n, effects[0]?.ledgers);
  process.stdout.write(`${JSON.stringify({
    database: config.database.name, prepare, rawParity: true, bounds: [5, 10], zeroOpen: true,
    zeroRewardStack: true, capFromLockedRemaining: true, failpointRollbackCount: 5,
    deterministicRollbackRetry: true, committedReplayWithoutRng: true, effects: effects[0],
    migrationAdded: false, operationalSnapshotTouched: false, operationalDatabaseTouched: false
  }, (_key, value) => typeof value === "bigint" ? value.toString() : value)}\n`);
} finally {
  await database.close();
}
