import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { OutboxWorker } from "../src/integration/outbox-worker.js";
import { STARTER_PACKAGE_DEFINITIONS } from "../src/package/starter-package-open-policy.js";
import { MariaStarterPackageOpenRepository } from "../src/package/maria-starter-package-open-repository.js";
import { StarterPackageOpenService, type StarterPackageOpenCommand } from "../src/package/starter-package-open-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic starter-package probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const playerId = 900000001n;
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";
const prefix = "starter-package-open-614a2e-v1";
const prepare = process.argv.includes("--prepare");
const consumerCodes = STARTER_PACKAGE_DEFINITIONS.map(({ consumerCode }) => consumerCode);
const rewardCodes = [...new Set(STARTER_PACKAGE_DEFINITIONS.flatMap(({ rewards }) => rewards.map(({ code }) => code)))];
const allCodes = [...consumerCodes, ...rewardCodes];

function command(stage: number, suffix: string): StarterPackageOpenCommand {
  return { externalUserId, channelId, message: `/초보오픈${stage}`, eventId: `${prefix}-${suffix}` };
}

async function ensureEvent(value: StarterPackageOpenCommand): Promise<void> {
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

async function run(value: StarterPackageOpenCommand, client: DatabaseClient = database) {
  await ensureEvent(value);
  return new StarterPackageOpenService(new MariaStarterPackageOpenRepository(client)).handle(value);
}

async function seed(stage: number, packageQuantity: bigint | null,
  rewardQuantities: Record<string, bigint> = {}, point = 1250n): Promise<void> {
  const definition = STARTER_PACKAGE_DEFINITIONS[stage - 1]!;
  await database.withTransaction(async (tx) => {
    const placeholders = allCodes.map(() => "?").join(", ");
    await tx.execute(
      `DELETE stack FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
       WHERE stack.player_id = ? AND item.code IN (${placeholders})`, [playerId, ...allCodes]
    );
    if (packageQuantity !== null) await tx.execute(
      `INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
       SELECT ?, id, ?, 1 FROM item_definitions WHERE code = ?`,
      [playerId, packageQuantity, definition.consumerCode]
    );
    for (const [code, quantity] of Object.entries(rewardQuantities)) await tx.execute(
      `INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
       SELECT ?, id, ?, 1 FROM item_definitions WHERE code = ?`, [playerId, quantity, code]
    );
    await tx.execute(
      `INSERT INTO currency_accounts (player_id, currency_code, balance, version) VALUES (?, 'point', ?, 1)
       ON DUPLICATE KEY UPDATE balance = VALUES(balance), version = VALUES(version)`, [playerId, `${point}.000`]
    );
  });
}

async function state(): Promise<{ quantities: Record<string, bigint>; point: string }> {
  const rows = await database.query<Array<{ code: string; quantity: bigint }>>(
    `SELECT item.code, stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
     WHERE stack.player_id = ? AND item.code IN (${allCodes.map(() => "?").join(", ")})`, [playerId, ...allCodes]
  );
  const accounts = await database.query<Array<{ balance: string }>>(
    "SELECT CAST(balance AS CHAR) AS balance FROM currency_accounts WHERE player_id = ? AND currency_code = 'point'", [playerId]
  );
  return { quantities: Object.fromEntries(rows.map(({ code, quantity }) => [code, quantity])), point: accounts[0]?.balance ?? "missing" };
}

function failpointClient(base: DatabaseClient, sqlFragment: string, occurrence = 1): DatabaseClient {
  let seen = 0;
  return {
    ping: () => base.ping(), verifyRollback: () => base.verifyRollback(), close: async () => undefined,
    query: (statement, values) => base.query(statement, values), execute: (statement, values) => base.execute(statement, values),
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => base.withTransaction(async (transaction) => {
      const proxy: DatabaseTransaction = {
        query: (statement, values) => transaction.query(statement, values),
        execute: async (statement, values) => {
          const result = await transaction.execute(statement, values);
          if (statement.includes(sqlFragment) && ++seen === occurrence) throw new Error(`synthetic failpoint:${sqlFragment}:${occurrence}`);
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
    await tx.execute("DELETE ledger FROM currency_ledger ledger JOIN operations op ON op.id = ledger.operation_id WHERE op.idempotency_key LIKE ?", [match]);
    await tx.execute("DELETE FROM operations WHERE idempotency_scope LIKE 'package.starter-open:%' AND idempotency_key LIKE ?", [match]);
    await tx.execute("DELETE FROM event_inbox WHERE event_id LIKE ?", [match]);
  });
}

async function expectConfigFailure(work: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(work, (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === code);
}

try {
  if (prepare) {
    await cleanup();
    const catalog = await database.query<Array<{ code: string }>>(
      `SELECT code FROM item_definitions WHERE code IN (${allCodes.map(() => "?").join(", ")}) ORDER BY code`, allCodes
    );
    assert.deepEqual(catalog.map(({ code }) => code), [...allCodes].sort());

    for (let stage = 1; stage <= 6; stage++) {
      const definition = STARTER_PACKAGE_DEFINITIONS[stage - 1]!;
      const initialPackage = stage === 1 ? 1n : 2n;
      const existing = stage === 3 ? Object.fromEntries(definition.rewards.map(({ code }) => [code, 0n])) : {};
      await seed(stage, initialPackage, existing);
      const result = await run(command(stage, `normal-${stage}`));
      assert.equal(result.status, "opened");
      if (result.status !== "opened") throw new Error("starter package did not open");
      assert.deepEqual(result.rewards.map(({ code, quantity }) => `${code}:${quantity}`), definition.rewards.map(({ code, quantity }) => `${code}:${quantity}`));
      assert.equal(result.data.endsWith("🅟100,000,000"), true);
      assert.equal(stage === 1 ? result.data.includes("첫 후원자") : !result.data.includes("첫 후원자"), true);
      const after = await state();
      assert.equal(after.quantities[definition.consumerCode] ?? 0n, initialPackage - 1n);
      assert.equal(after.point, "100001250.000");
    }

    for (const [suffix, quantity] of [["undefined", null], ["zero", 0n]] as const) {
      await seed(1, quantity);
      const result = await run(command(1, suffix));
      assert.equal(result.status, "package_required");
      assert.match("data" in result ? result.data : "", /hoiland123\.tistory\.com/);
      assert.equal((await state()).point, "1250.000");
    }
    const unregistered = await new StarterPackageOpenService(new MariaStarterPackageOpenRepository(database)).handle({
      externalUserId: "synthetic-unregistered", channelId, message: "/초보오픈1", eventId: `${prefix}-unregistered`
    });
    assert.equal(unregistered.status, "ignored_unregistered");
    await database.execute("UPDATE castle_battle_seasons SET starts_at = UTC_TIMESTAMP(3), ends_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 DAY) WHERE id = 900000001");
    try {
      await seed(1, 1n);
      assert.equal((await run(command(1, "castle"))).status, "blocked_by_castle_siege");
      assert.equal((await state()).quantities.starter_package_01, 1n);
    } finally {
      await database.execute("UPDATE castle_battle_seasons SET starts_at = '2026-01-01 00:00:00.000', ends_at = '2026-01-31 23:59:59.000' WHERE id = 900000001");
    }

    await seed(2, 1n);
    const duplicateCommand = command(2, "duplicate");
    const first = await run(duplicateCommand);
    const duplicate = await run(duplicateCommand);
    assert.equal(first.status, "opened");
    assert.equal("duplicate" in duplicate && duplicate.duplicate, true);
    assert.equal((await state()).point, "100001250.000");

    await seed(3, 1n);
    const concurrent = await Promise.all([run(command(3, "concurrent-a")), run(command(3, "concurrent-b"))]);
    assert.deepEqual(concurrent.map(({ status }) => status).sort(), ["opened", "package_required"]);
    assert.equal((await state()).point, "100001250.000");

    await seed(1, 1n);
    await database.execute("UPDATE package_definitions SET active = FALSE WHERE code = 'starter_01'");
    try { await expectConfigFailure(() => run(command(1, "disabled-package")), "STARTER_PACKAGE_DEFINITION_DISABLED"); }
    finally { await database.execute("UPDATE package_definitions SET active = TRUE WHERE code = 'starter_01'"); }
    await database.execute("UPDATE package_contents SET quantity = 31.000 WHERE package_id = 900000002 AND sequence_no = 3");
    try { await expectConfigFailure(() => run(command(1, "bad-content")), "STARTER_PACKAGE_CONTENT_INVALID"); }
    finally { await database.execute("UPDATE package_contents SET quantity = 30.000 WHERE package_id = 900000002 AND sequence_no = 3"); }
    await database.execute("UPDATE item_definitions SET active = FALSE WHERE code = 'tier_upgrade_ticket'");
    try { await expectConfigFailure(() => run(command(1, "disabled-item")), "STARTER_PACKAGE_ITEM_DEFINITION_DISABLED"); }
    finally { await database.execute("UPDATE item_definitions SET active = TRUE WHERE code = 'tier_upgrade_ticket'"); }
    await database.execute("UPDATE external_identities SET player_id = 900000003 WHERE id = 900000004");
    await database.execute("DELETE FROM currency_accounts WHERE player_id = 900000003 AND currency_code = 'point'");
    try { await expectConfigFailure(() => run(command(1, "missing-point")), "STARTER_PACKAGE_POINT_ACCOUNT_REQUIRED"); }
    finally {
      await database.execute("INSERT INTO currency_accounts (player_id, currency_code, balance, version) VALUES (900000003, 'point', 300.000, 1)");
      await database.execute("UPDATE external_identities SET player_id = 900000001 WHERE id = 900000004");
    }
    await database.execute("UPDATE currency_accounts SET balance = 999999999999999999999999999.000, version = version + 1 WHERE player_id = ? AND currency_code = 'point'", [playerId]);
    try { await expectConfigFailure(() => run(command(1, "point-range")), "STARTER_PACKAGE_POINT_BALANCE_RANGE"); }
    finally { await database.execute("UPDATE currency_accounts SET balance = 1250.000, version = version + 1 WHERE player_id = ? AND currency_code = 'point'", [playerId]); }

    const failpoints = [
      ["INSERT INTO operations", 1], ["DELETE FROM inventory_stacks", 1], ["UPDATE inventory_stacks SET quantity", 1],
      ["INSERT INTO inventory_stacks", 1], ["INSERT INTO inventory_ledger", 1], ["UPDATE currency_accounts", 1],
      ["INSERT INTO currency_ledger", 1], ["INSERT INTO command_executions", 1], ["INSERT INTO command_audit", 1],
      ["INSERT INTO outbox_messages", 1], ["UPDATE operations SET status", 1]
    ] as const;
    for (let index = 0; index < failpoints.length; index++) {
      const [sql, occurrence] = failpoints[index]!;
      await seed(6, sql === "DELETE FROM inventory_stacks" ? 1n : 2n, sql === "INSERT INTO inventory_stacks" ? {} : { lucky_box: 0n });
      const value = command(6, `fail-${index}`);
      const before = await state();
      await assert.rejects(() => run(value, failpointClient(database, sql, occurrence)), /synthetic failpoint/);
      assert.deepEqual(await state(), before);
      assert.equal(await executionCount(value.eventId), 0n);
    }

    await seed(5, 1n);
    const retryCommand = command(5, "rollback-retry");
    await assert.rejects(() => run(retryCommand, failpointClient(database, "INSERT INTO command_audit")), /synthetic failpoint/);
    const retry = await run(retryCommand);
    assert.equal(retry.status, "opened");
    assert.equal((await state()).point, "100001250.000");

    await database.execute(
      `UPDATE outbox_messages outbox JOIN operations op ON op.id = outbox.operation_id SET outbox.status = 'sent', outbox.sent_at = UTC_TIMESTAMP(3)
       WHERE op.idempotency_key LIKE ? AND outbox.status = 'pending'`, [`${prefix}%`]
    );
    await seed(6, 1n);
    const restart = await run(command(6, "restart"));
    assert.equal(restart.status, "opened");
  } else {
    const delivered: string[] = [];
    const worker = new OutboxWorker(database, async ({ data }) => { delivered.push(data); });
    assert.equal(await worker.runOnce(20), 1);
    assert.equal(delivered[0]?.includes("초보자 스타터패키지🌟[6] 패키지오픈!!"), true);
    assert.equal(await worker.runOnce(20), 0);
    const replay = await run(command(6, "restart"));
    assert.equal("duplicate" in replay && replay.duplicate, true);
    const attempts = await database.query<Array<{ value: bigint }>>(
      `SELECT COUNT(*) AS value FROM delivery_attempts attempt JOIN outbox_messages outbox ON outbox.id = attempt.outbox_message_id
       JOIN operations op ON op.id = outbox.operation_id WHERE op.idempotency_key = ?`, [`${prefix}-restart`]
    );
    assert.equal(attempts[0]?.value, 1n);
  }

  const effects = await database.query<Array<{ operations: bigint; executions: bigint; audits: bigint; outboxes: bigint }>>(
    `SELECT
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'package.starter-open:%' AND idempotency_key LIKE ?) operations,
       (SELECT COUNT(*) FROM command_executions WHERE event_id LIKE ?) executions,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations op ON op.id = audit.operation_id WHERE op.idempotency_key LIKE ?) audits,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations op ON op.id = outbox.operation_id WHERE op.idempotency_key LIKE ?) outboxes`,
    [`${prefix}%`, `${prefix}%`, `${prefix}%`, `${prefix}%`]
  );
  assert.equal(effects[0]?.operations, effects[0]?.executions);
  assert.equal(effects[0]?.operations, effects[0]?.audits);
  assert.equal(effects[0]?.operations, effects[0]?.outboxes);
  process.stdout.write(`${JSON.stringify({
    database: config.database.name, prepare, exactGuard: true, stages: 6, packageUndefinedZeroOneTwo: true,
    rewardOrderAndQuantities: true, exactReplies: true, firstSupporterStageOneOnly: true,
    castleAndUnregisteredSilent: true, stableItemAndPackageCodes: true, duplicateNoEffect: true,
    concurrentLockedRemaining: true, configPolicies: 5, failpointRollbackCount: 11,
    restartReplayOnce: !prepare, migrationAdded: false, effects: effects[0],
    legacySafetyDifference: "DB atomic rollback/outbox replaces direct reply then outer JSON save",
    operationalSnapshotTouched: false, operationalDatabaseTouched: false
  }, (_key, value) => typeof value === "bigint" ? value.toString() : value)}\n`);
} finally {
  await database.close();
}
