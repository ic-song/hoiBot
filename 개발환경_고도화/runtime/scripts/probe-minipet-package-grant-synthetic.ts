import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { OutboxWorker } from "../src/integration/outbox-worker.js";
import { MINIPET_PACKAGE_GRANTS } from "../src/admin/minipet-package-grant-policy.js";
import { MariaMinipetPackageGrantRepository } from "../src/admin/maria-minipet-package-grant-repository.js";
import { MinipetPackageGrantService } from "../src/admin/minipet-package-grant-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic minipet-package grant probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const playerId = 900000002n;
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";
const prefix = "admin-minipet-package-grant-a8d2c4-v1";
const prepare = process.argv.includes("--prepare");
const itemCodes = MINIPET_PACKAGE_GRANTS.map(({ itemCode }) => itemCode);

function command(message: string, suffix: string, roomAllowed = true) {
  return { externalUserId, channelId, message, eventId: `${prefix}-${suffix}`, roomAllowed };
}

async function ensureEvent(value: ReturnType<typeof command>): Promise<void> {
  await database.execute(
    `INSERT INTO event_inbox
       (event_id, provider_code, provider_event_id, external_channel_id, channel_id, external_user_id,
        external_identity_id, event_kind, event_origin, direction, payload_hash, parse_status, processing_status, received_at)
     VALUES (?, 'iris', ?, ?, 900000001, ?, 900000004, 'message', 'synthetic_probe', 'incoming',
       REPEAT('0', 64), 'parsed', 'processed', UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE processing_status = VALUES(processing_status)`,
    [value.eventId, value.eventId, channelId, externalUserId]
  );
}

async function run(value: ReturnType<typeof command>, client: DatabaseClient = database) {
  await ensureEvent(value);
  return new MinipetPackageGrantService(new MariaMinipetPackageGrantRepository(client)).handle(value);
}

async function seed(quantities: Record<string, bigint> = {}): Promise<void> {
  await database.withTransaction(async (tx) => {
    await tx.execute(
      `DELETE stack FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
       WHERE stack.player_id = ? AND item.code IN (${itemCodes.map(() => "?").join(", ")})`, [playerId, ...itemCodes]
    );
    for (const [code, quantity] of Object.entries(quantities)) await tx.execute(
      `INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
       SELECT ?, id, ?, 1 FROM item_definitions WHERE code = ?`, [playerId, quantity, code]
    );
  });
}

async function quantities(): Promise<Record<string, bigint>> {
  const rows = await database.query<Array<{ code: string; quantity: bigint }>>(
    `SELECT item.code, stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
     WHERE stack.player_id = ? AND item.code IN (${itemCodes.map(() => "?").join(", ")})`, [playerId, ...itemCodes]
  );
  return Object.fromEntries(rows.map(({ code, quantity }) => [code, quantity]));
}

function failpointClient(base: DatabaseClient, sqlFragment: string): DatabaseClient {
  let fired = false;
  return {
    ping: () => base.ping(), verifyRollback: () => base.verifyRollback(), close: async () => undefined,
    query: (statement, values) => base.query(statement, values), execute: (statement, values) => base.execute(statement, values),
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => base.withTransaction(async (transaction) => {
      const proxy: DatabaseTransaction = {
        query: (statement, values) => transaction.query(statement, values),
        execute: async (statement, values) => {
          const result = await transaction.execute(statement, values);
          if (!fired && statement.includes(sqlFragment)) { fired = true; throw new Error(`synthetic failpoint:${sqlFragment}`); }
          return result;
        }
      };
      return work(proxy);
    })
  };
}

async function executionCount(eventId: string): Promise<bigint> {
  const rows = await database.query<Array<{ value: bigint }>>("SELECT COUNT(*) AS value FROM command_executions WHERE event_id = ?", [eventId]);
  return rows[0]?.value ?? -1n;
}

async function cleanup(): Promise<void> {
  await database.withTransaction(async (tx) => {
    const match = `${prefix}%`;
    await tx.execute("DELETE attempt FROM delivery_attempts attempt JOIN outbox_messages outbox ON outbox.id = attempt.outbox_message_id JOIN operations op ON op.id = outbox.operation_id WHERE op.idempotency_key LIKE ?", [match]);
    await tx.execute("DELETE outbox FROM outbox_messages outbox JOIN operations op ON op.id = outbox.operation_id WHERE op.idempotency_key LIKE ?", [match]);
    await tx.execute("DELETE audit FROM command_audit audit JOIN operations op ON op.id = audit.operation_id WHERE op.idempotency_key LIKE ?", [match]);
    await tx.execute("DELETE FROM command_executions WHERE event_id LIKE ?", [match]);
    await tx.execute("DELETE ledger FROM inventory_ledger ledger JOIN operations op ON op.id = ledger.operation_id WHERE op.idempotency_key LIKE ?", [match]);
    await tx.execute("DELETE FROM operations WHERE idempotency_scope LIKE 'admin.minipet-package-grant:%' AND idempotency_key LIKE ?", [match]);
    await tx.execute("DELETE FROM event_inbox WHERE event_id LIKE ?", [match]);
  });
}

try {
  if (prepare) {
    await cleanup();
    const definitions = await database.query<Array<{ code: string; display_name: string }>>(
      `SELECT code, display_name FROM item_definitions WHERE code IN (${itemCodes.map(() => "?").join(", ")}) ORDER BY code`, itemCodes
    );
    assert.deepEqual(definitions.map(({ code }) => code), [...itemCodes].sort());

    await seed();
    const genesis = await run(command("/창세패키지, 테스트베타", "genesis-default"));
    assert.equal(genesis.status, "granted");
    assert.equal((await quantities()).bag_b2fd551a03f6fe6e, 1n);
    await seed({ bag_11319869697c3c00: 4n });
    const creation = await run(command("/창조패키지3, 테스트베타", "creation-three"));
    assert.equal(creation.status, "granted");
    assert.equal((await quantities()).bag_11319869697c3c00, 7n);

    for (const [suffix, message, expected] of [
      ["zero", "/창세패키지0, 테스트베타", "invalid_amount"],
      ["leading", " /창세패키지, 테스트베타", "invalid_format"],
      ["empty", "/창세패키지, ", "target_not_found"],
      ["missing", "/창세패키지, 없는대상", "target_not_found"]
    ] as const) assert.equal((await run(command(message, suffix))).status, expected);
    assert.equal((await run(command("/창세패키지, 테스트베타", "outside", false))).status, "ignored_outside_room");
    const forbidden = await new MinipetPackageGrantService(new MariaMinipetPackageGrantRepository(database)).handle({
      externalUserId: "synthetic-non-admin-gamma", channelId, message: "/창세패키지, 테스트베타",
      eventId: `${prefix}-forbidden`, roomAllowed: true
    });
    assert.equal(forbidden.status, "ignored_forbidden");

    await seed();
    const duplicateCommand = command("/창조패키지2, 테스트베타", "duplicate");
    assert.equal((await run(duplicateCommand)).status, "granted");
    const duplicate = await run(duplicateCommand);
    assert.equal("duplicate" in duplicate && duplicate.duplicate, true);
    assert.equal((await quantities()).bag_11319869697c3c00, 2n);

    await seed();
    const concurrent = await Promise.all([
      run(command("/창세패키지2, 테스트베타", "concurrent-a")),
      run(command("/창세패키지3, 테스트베타", "concurrent-b"))
    ]);
    assert.deepEqual(concurrent.map(({ status }) => status), ["granted", "granted"]);
    assert.equal((await quantities()).bag_b2fd551a03f6fe6e, 5n);

    await database.execute("UPDATE item_definitions SET active = FALSE WHERE code = 'bag_b2fd551a03f6fe6e'");
    try { await assert.rejects(() => run(command("/창세패키지, 테스트베타", "disabled")), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "MINIPET_PACKAGE_ITEM_DEFINITION_INVALID"); }
    finally { await database.execute("UPDATE item_definitions SET active = TRUE WHERE code = 'bag_b2fd551a03f6fe6e'"); }
    await database.execute("UPDATE item_definitions SET code = 'synthetic_missing_genesis_package' WHERE code = 'bag_b2fd551a03f6fe6e'");
    try { await assert.rejects(() => run(command("/창세패키지, 테스트베타", "missing-definition")), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "MINIPET_PACKAGE_ITEM_DEFINITION_REQUIRED"); }
    finally { await database.execute("UPDATE item_definitions SET code = 'bag_b2fd551a03f6fe6e' WHERE code = 'synthetic_missing_genesis_package'"); }

    const failpoints = [
      "INSERT IGNORE INTO inventory_stacks", "INSERT INTO operations", "UPDATE inventory_stacks SET quantity",
      "INSERT INTO inventory_ledger", "INSERT INTO command_executions", "INSERT INTO command_audit",
      "INSERT INTO outbox_messages", "UPDATE operations SET status"
    ];
    for (let index = 0; index < failpoints.length; index++) {
      const sql = failpoints[index]!;
      await seed(sql === "INSERT IGNORE INTO inventory_stacks" ? {} : { bag_11319869697c3c00: 0n });
      const value = command("/창조패키지2, 테스트베타", `fail-${index}`);
      const before = await quantities();
      await assert.rejects(() => run(value, failpointClient(database, sql)), /synthetic failpoint/);
      assert.deepEqual(await quantities(), before);
      assert.equal(await executionCount(value.eventId), 0n);
    }

    await seed();
    const retryCommand = command("/창세패키지4, 테스트베타", "rollback-retry");
    await assert.rejects(() => run(retryCommand, failpointClient(database, "INSERT INTO command_audit")), /synthetic failpoint/);
    assert.equal((await run(retryCommand)).status, "granted");
    assert.equal((await quantities()).bag_b2fd551a03f6fe6e, 4n);

    await database.execute(
      `UPDATE outbox_messages outbox JOIN operations op ON op.id = outbox.operation_id SET outbox.status = 'sent', outbox.sent_at = UTC_TIMESTAMP(3)
       WHERE op.idempotency_key LIKE ? AND outbox.status = 'pending'`, [`${prefix}%`]
    );
    await seed();
    assert.equal((await run(command("/창조패키지5, 테스트베타", "restart"))).status, "granted");
  } else {
    const delivered: string[] = [];
    const worker = new OutboxWorker(database, async ({ data }) => { delivered.push(data); });
    assert.equal(await worker.runOnce(20), 1);
    assert.equal(delivered[0], "테스트베타님에게 컬렉션창조패키지🐹(/컬렉션창조오픈) 5개를 지급했습니다.");
    assert.equal(await worker.runOnce(20), 0);
    const replay = await run(command("/창조패키지5, 테스트베타", "restart"));
    assert.equal("duplicate" in replay && replay.duplicate, true);
    assert.equal((await quantities()).bag_11319869697c3c00, 5n);
  }

  const effects = await database.query<Array<{ operations: bigint; executions: bigint; audits: bigint; outboxes: bigint; ledgers: bigint }>>(
    `SELECT
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'admin.minipet-package-grant:%' AND idempotency_key LIKE ?) operations,
       (SELECT COUNT(*) FROM command_executions WHERE event_id LIKE ?) executions,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations op ON op.id = audit.operation_id WHERE op.idempotency_key LIKE ?) audits,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations op ON op.id = outbox.operation_id WHERE op.idempotency_key LIKE ?) outboxes,
       (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations op ON op.id = ledger.operation_id WHERE op.idempotency_key LIKE ?) ledgers`,
    [`${prefix}%`, `${prefix}%`, `${prefix}%`, `${prefix}%`, `${prefix}%`]
  );
  assert.equal(effects[0]?.operations, effects[0]?.executions);
  assert.equal(effects[0]?.operations, effects[0]?.audits);
  assert.equal(effects[0]?.operations, effects[0]?.outboxes);
  assert.equal(effects[0]?.operations, effects[0]?.ledgers);
  process.stdout.write(`${JSON.stringify({
    database: config.database.name, prepare, rawParity: true, defaultAndMultiple: true,
    forbiddenAndOutsideSilent: true, missingAndExistingStack: true, duplicateNoEffect: true,
    concurrentExactSum: true, definitionPolicies: 2, failpointRollbackCount: 8,
    restartReplayOnce: !prepare, migrationAdded: false, effects: effects[0],
    operationalSnapshotTouched: false, operationalDatabaseTouched: false
  }, (_key, value) => typeof value === "bigint" ? value.toString() : value)}\n`);
} finally {
  await database.close();
}
