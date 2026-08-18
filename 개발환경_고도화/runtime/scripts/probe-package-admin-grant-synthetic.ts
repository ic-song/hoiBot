import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { OutboxWorker } from "../src/integration/outbox-worker.js";
import { MariaPackageAdminGrantRepository } from "../src/package/maria-package-admin-grant-repository.js";
import { PackageAdminGrantService } from "../src/package/package-admin-grant-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic package-admin-grant probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const playerId = 900000002n;
const itemCode = "synthetic_package_token";
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";
const prefix = "package-admin-grant-8f3a2b-v1";
const prepare = process.argv.includes("--prepare");

function command(message: string, suffix: string) {
  return { externalUserId, channelId, message, eventId: `${prefix}-${suffix}` };
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
  return new PackageAdminGrantService(new MariaPackageAdminGrantRepository(client)).handle(value);
}

async function seed(quantity?: bigint): Promise<void> {
  await database.execute(
    `DELETE stack FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
     WHERE stack.player_id = ? AND item.code = ?`, [playerId, itemCode]
  );
  if (quantity !== undefined) {
    await database.execute(
      `INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
       SELECT ?, id, ?, 1 FROM item_definitions WHERE code = ?`, [playerId, quantity, itemCode]
    );
  }
}

async function quantity(): Promise<bigint | null> {
  const rows = await database.query<Array<{ quantity: bigint }>>(
    `SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
     WHERE stack.player_id = ? AND item.code = ?`, [playerId, itemCode]
  );
  return rows[0]?.quantity ?? null;
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
          if (!fired && statement.includes(sqlFragment)) {
            fired = true;
            throw new Error(`synthetic failpoint:${sqlFragment}`);
          }
          return result;
        }
      };
      return work(proxy);
    })
  };
}

async function executionCount(eventId: string): Promise<bigint> {
  const rows = await database.query<Array<{ value: bigint }>>(
    "SELECT COUNT(*) AS value FROM command_executions WHERE event_id = ?", [eventId]
  );
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
    await tx.execute("DELETE FROM operations WHERE idempotency_scope LIKE 'package.admin.grant:%' AND idempotency_key LIKE ?", [match]);
    await tx.execute("DELETE FROM event_inbox WHERE event_id LIKE ?", [match]);
  });
}

try {
  if (prepare) {
    await cleanup();
    const catalog = await database.query<Array<{ version: bigint; entries: string }>>(
      `SELECT config.version, CAST(value.json_value AS CHAR) AS entries
       FROM configuration_sets config JOIN configuration_values value ON value.configuration_set_id = config.id
       WHERE config.set_code = 'package-catalog' AND config.status = 'active'
         AND value.config_key = 'package.catalog.entries' ORDER BY config.version DESC`
    );
    assert.equal(catalog[0]?.version, 1n);
    assert.match(catalog[0]?.entries ?? "", /synthetic_package_token/);

    await seed();
    const one = await run(command("/패키지지급 테스트베타 1 1", "missing-stack"));
    assert.equal(one.status, "granted");
    assert.equal(await quantity(), 1n);
    assert.equal("catalogVersion" in one && one.catalogVersion, "1");

    await seed(2n);
    const many = await run(command("/패키지지급 테스트베타 1 10000", "existing-stack-max-count"));
    assert.equal(many.status, "granted");
    assert.equal(await quantity(), 10002n);
    assert.match("data" in many ? many.data : "", /지급 수량: 10,000개/);

    for (const [suffix, message, expected] of [
      ["zero-count", "/패키지지급 테스트베타 1 0", "invalid_count"],
      ["over-count", "/패키지지급 테스트베타 1 10001", "invalid_count"],
      ["zero-list", "/패키지지급 테스트베타 0 1", "package_not_found"],
      ["huge-list", "/패키지지급 테스트베타 9007199254740993 1", "package_not_found"],
      ["missing-target", "/패키지지급 없는 대상 1 1", "target_not_found"]
    ] as const) assert.equal((await run(command(message, suffix))).status, expected);
    for (const [suffix, message] of [
      ["leading", " /패키지지급 테스트베타 1 1"],
      ["trailing", "/패키지지급 테스트베타 1 1 "],
      ["negative", "/패키지지급 테스트베타 -1 1"],
      ["decimal", "/패키지지급 테스트베타 1 1.0"],
      ["suffix", "/패키지지급 테스트베타 1 1 안내"]
    ]) assert.equal((await run(command(message, suffix))).status, "ignored_not_candidate");
    const forbidden = await new PackageAdminGrantService(new MariaPackageAdminGrantRepository(database)).handle({
      externalUserId: "synthetic-non-admin-gamma", channelId,
      message: "/패키지지급 테스트베타 1 1", eventId: `${prefix}-forbidden`
    });
    assert.equal(forbidden.status, "ignored_forbidden");

    await database.execute("UPDATE package_definitions SET active = FALSE WHERE code = 'synthetic-starter-package'");
    try {
      assert.equal((await run(command("/패키지지급 테스트베타 1 1", "disabled-package"))).status, "package_disabled");
    } finally {
      await database.execute("UPDATE package_definitions SET active = TRUE WHERE code = 'synthetic-starter-package'");
    }
    await database.execute("UPDATE item_definitions SET metadata_json = JSON_OBJECT('synthetic', TRUE) WHERE code = ?", [itemCode]);
    try {
      assert.equal((await run(command("/패키지지급 테스트베타 1 1", "invalid-binding"))).status, "package_name_invalid");
    } finally {
      await database.execute(
        `UPDATE item_definitions SET metadata_json = JSON_OBJECT(
          'synthetic', TRUE, 'slice', 'SL-PACKAGE-ADMIN-GRANT',
          'packageCode', 'synthetic-starter-package', 'legacyBagKey', '합성 스타터 패키지'
        ) WHERE code = ?`, [itemCode]
      );
    }

    await seed();
    const duplicateCommand = command("/패키지지급 테스트베타 1 3", "duplicate");
    assert.equal((await run(duplicateCommand)).status, "granted");
    const duplicate = await run(duplicateCommand);
    assert.equal("duplicate" in duplicate && duplicate.duplicate, true);
    assert.equal(await quantity(), 3n);

    await seed();
    const concurrent = await Promise.all([
      run(command("/패키지지급 테스트베타 1 4", "concurrent-a")),
      run(command("/패키지지급 테스트베타 1 6", "concurrent-b"))
    ]);
    assert.deepEqual(concurrent.map(({ status }) => status), ["granted", "granted"]);
    assert.equal(await quantity(), 10n);

    await seed(18446744073709551615n);
    await assert.rejects(
      () => run(command("/패키지지급 테스트베타 1 1", "overflow")),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error
        && error.code === "PACKAGE_GRANT_QUANTITY_OVERFLOW"
    );
    assert.equal(await quantity(), 18446744073709551615n);

    const failpoints = [
      "INSERT IGNORE INTO inventory_stacks", "INSERT IGNORE INTO operations",
      "UPDATE inventory_stacks SET quantity", "INSERT INTO inventory_ledger",
      "INSERT INTO command_executions", "INSERT INTO command_audit",
      "INSERT INTO outbox_messages", "UPDATE operations SET status"
    ];
    for (let index = 0; index < failpoints.length; index++) {
      const sql = failpoints[index]!;
      await seed(index === 0 ? undefined : 0n);
      const value = command("/패키지지급 테스트베타 1 2", `fail-${index}`);
      const before = await quantity();
      await assert.rejects(() => run(value, failpointClient(database, sql)), /synthetic failpoint/);
      assert.equal(await quantity(), before);
      assert.equal(await executionCount(value.eventId), 0n);
    }

    await seed();
    const retry = command("/패키지지급 테스트베타 1 7", "rollback-retry");
    await assert.rejects(() => run(retry, failpointClient(database, "INSERT INTO command_audit")), /synthetic failpoint/);
    assert.equal((await run(retry)).status, "granted");
    assert.equal(await quantity(), 7n);

    await database.execute(
      `UPDATE outbox_messages outbox JOIN operations op ON op.id = outbox.operation_id
       SET outbox.status = 'sent', outbox.sent_at = UTC_TIMESTAMP(3)
       WHERE op.idempotency_key LIKE ? AND outbox.status = 'pending'`, [`${prefix}%`]
    );
    await seed();
    assert.equal((await run(command("/패키지지급 테스트베타 1 5", "restart"))).status, "granted");
  } else {
    const delivered: string[] = [];
    const worker = new OutboxWorker(database, async ({ data }) => { delivered.push(data); });
    assert.equal(await worker.runOnce(20), 1);
    assert.equal(delivered[0], [
      "✅ 패키지 지급 완료", "", "대상: 테스트베타", "패키지: 합성 스타터 패키지",
      "지급 수량: 5개", "보유 수량: 0개 → 5개", "지급자: 테스트관리자알파"
    ].join("\n"));
    assert.equal(await worker.runOnce(20), 0);
    const replay = await run(command("/패키지지급 테스트베타 1 5", "restart"));
    assert.equal("duplicate" in replay && replay.duplicate, true);
    assert.equal(await quantity(), 5n);
  }

  const effects = await database.query<Array<{
    operations: bigint; executions: bigint; audits: bigint; outboxes: bigint; ledgers: bigint;
  }>>(
    `SELECT
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'package.admin.grant:%' AND idempotency_key LIKE ?) operations,
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
    database: config.database.name, prepare, rawParity: true, countRange: "1..10000",
    safeBigIntParser: true, catalogVersionPin: "1", stablePackageItemBinding: true,
    missingAndExistingStack: true, forbiddenSilent: true, duplicateNoEffect: true,
    concurrentExactSum: true, overflowRollback: true, failpointRollbackCount: 8,
    restartReplayOnce: !prepare, migrationAdded: false, grantLedgerAdded: false,
    effects: effects[0], operationalSnapshotTouched: false, operationalDatabaseTouched: false
  }, (_key, value) => typeof value === "bigint" ? value.toString() : value)}\n`);
} finally {
  await database.close();
}
