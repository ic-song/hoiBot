import assert from "node:assert/strict";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { AdminDailyPayoutService } from "../src/admin/daily-payout-service.js";

const database = createDatabaseClient({ enabled: true, host: process.env.DB_HOST ?? "127.0.0.1", port: Number(process.env.DB_PORT ?? "13307"), user: process.env.DB_USER ?? "root", password: process.env.DB_PASSWORD ?? "", name: process.env.DB_NAME ?? "hoibot", connectionLimit: 6, connectTimeoutMs: 5000 });
const playerIds = [900000001n, 900000002n];

// 합성 관리자 두 명과 안정 외부 identity 매핑을 준비합니다.
async function seedAdmins(): Promise<void> {
  await database.execute("INSERT INTO admin_operators (login_id, display_name, password_hash, status) VALUES ('daily-payout-alpha','호이 남',REPEAT('a',64),'active'),('daily-payout-beta','오픈채팅봇',REPEAT('b',64),'active') ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), status='active'");
  await database.execute(`INSERT IGNORE INTO admin_operator_external_identities (operator_id, external_identity_id)
    SELECT operator.id, identity.id FROM admin_operators operator JOIN external_identities identity
      ON (operator.login_id='daily-payout-alpha' AND identity.external_user_id='synthetic-admin-alpha')
      OR (operator.login_id='daily-payout-beta' AND identity.external_user_id='synthetic-user-beta')`);
  await database.execute(`INSERT INTO admin_daily_payout_operators (operator_id, legacy_display_name, active)
    SELECT mapping.operator_id, '호이 남', TRUE FROM admin_operator_external_identities mapping
    JOIN external_identities identity ON identity.id=mapping.external_identity_id
    WHERE identity.external_user_id='synthetic-admin-alpha' ON DUPLICATE KEY UPDATE active=TRUE`);
  await database.execute("UPDATE currency_accounts SET balance=100, version=version+1 WHERE currency_code='point' AND player_id IN (?, ?)", playerIds);
}

// command execution FK용 합성 event를 준비합니다.
async function seedEvent(eventId: string): Promise<void> { await database.execute("INSERT IGNORE INTO event_inbox (event_id,event_kind,processing_status,received_at) VALUES (?,'message','processing',UTC_TIMESTAMP(3))", [eventId]); }

// 첫 수신자 grant 뒤 실패를 주입해 batch rollback을 검증합니다.
function failAtGrant(inner: DatabaseClient): DatabaseClient {
  return { ping: () => inner.ping(), verifyRollback: () => inner.verifyRollback(), query: (sql, values) => inner.query(sql, values), execute: (sql, values) => inner.execute(sql, values), close: async () => undefined,
    withTransaction: <T>(work: (tx: DatabaseTransaction) => Promise<T>) => inner.withTransaction((tx) => work({ query: (sql, values) => tx.query(sql, values), execute: async (sql, values) => { if (sql.includes("INSERT INTO admin_daily_payout_grants")) throw new Error("synthetic payout grant failure"); return tx.execute(sql, values); } })) };
}

const command = (eventId: string, externalUserId = "synthetic-admin-alpha") => ({ externalUserId, channelId: "synthetic-room-001", message: "/관리자일당", eventId });

try {
  await seedAdmins(); await seedEvent("admin-daily-probe-normal");
  const service = new AdminDailyPayoutService(database);
  const first = await service.handle(command("admin-daily-probe-normal"));
  const replay = await service.handle(command("admin-daily-probe-normal"));
  assert.equal(first.status, "paid"); assert.equal(first.recipientCount, "2"); assert.equal(replay.duplicate, true);
  const normal = await database.query<Array<{ operations: bigint; executions: bigint; grants: bigint; ledgers: bigint; delta: string }>>(`SELECT
    (SELECT COUNT(*) FROM operations WHERE idempotency_key='admin-daily-probe-normal') AS operations,
    (SELECT COUNT(*) FROM admin_daily_payout_executions execution JOIN operations operation_row ON operation_row.id=execution.operation_id WHERE operation_row.idempotency_key='admin-daily-probe-normal') AS executions,
    (SELECT COUNT(*) FROM admin_daily_payout_grants grant_row JOIN admin_daily_payout_executions execution ON execution.id=grant_row.execution_id JOIN operations operation_row ON operation_row.id=execution.operation_id WHERE operation_row.idempotency_key='admin-daily-probe-normal') AS grants,
    (SELECT COUNT(*) FROM currency_ledger ledger JOIN operations operation_row ON operation_row.id=ledger.operation_id WHERE operation_row.idempotency_key='admin-daily-probe-normal') AS ledgers,
    (SELECT CAST(SUM(delta) AS CHAR) FROM currency_ledger ledger JOIN operations operation_row ON operation_row.id=ledger.operation_id WHERE operation_row.idempotency_key='admin-daily-probe-normal') AS delta`);
  assert.deepEqual(normal[0], { operations: 1n, executions: 1n, grants: 2n, ledgers: 2n, delta: "2000000000.000" });

  const denied = await service.handle(command("admin-daily-probe-denied", "synthetic-unlinked"));
  assert.deepEqual(denied, { status: "ignored_unauthorized" });

  await seedEvent("admin-daily-probe-failure");
  const beforeFailure = await database.query<Array<{ total: string }>>("SELECT CAST(SUM(balance) AS CHAR) AS total FROM currency_accounts WHERE currency_code='point' AND player_id IN (?, ?)", playerIds);
  await assert.rejects(() => new AdminDailyPayoutService(failAtGrant(database)).handle(command("admin-daily-probe-failure")), /synthetic payout grant failure/);
  const afterFailure = await database.query<Array<{ total: string; operations: bigint }>>(`SELECT
    (SELECT CAST(SUM(balance) AS CHAR) FROM currency_accounts WHERE currency_code='point' AND player_id IN (?, ?)) AS total,
    (SELECT COUNT(*) FROM operations WHERE idempotency_key='admin-daily-probe-failure') AS operations`, playerIds);
  assert.equal(afterFailure[0]?.total, beforeFailure[0]?.total); assert.equal(afterFailure[0]?.operations, 0n);

  await seedEvent("admin-daily-probe-concurrent");
  const concurrent = await Promise.all([service.handle(command("admin-daily-probe-concurrent")), service.handle(command("admin-daily-probe-concurrent"))]);
  assert.equal(concurrent.filter((result) => result.duplicate === true).length, 1);
  const concurrentOps = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM operations WHERE idempotency_key='admin-daily-probe-concurrent'");
  assert.equal(concurrentOps[0]?.count, 1n);

  await seedEvent("admin-daily-probe-distinct");
  const distinct = await service.handle(command("admin-daily-probe-distinct"));
  assert.equal(distinct.status, "paid");
  process.stdout.write(`${JSON.stringify({ scenarios: ["stable-admin-roster", "atomic-two-recipient-payout", "unauthorized-silent", "same-event-replay", "distinct-event-legacy-repeat", "mid-batch-rollback", "concurrent-same-event"], first, rollback: true, concurrent: true, distinctEventRepeat: true })}\n`);
} finally { await database.close(); }
