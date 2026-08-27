import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../src/dispatch/command-dispatcher.js";
import { OperationNoticeReader, OperationNoticeService } from "../src/admin/operation-notice-service.js";

const database = createDatabaseClient(loadConfig().database);
const restart = process.argv.includes("--verify-restart");
const externalUserId = "synthetic-operation-notice-admin";
const room = "synthetic-operation-notice-room";
const eventPrefix = "synthetic-operation-notice";

async function count(sql: string, values: readonly unknown[] = []): Promise<bigint> {
  return BigInt((await database.query<Array<{ value: bigint | string }>>(sql, values))[0]?.value ?? 0);
}

async function event(eventId: string): Promise<void> {
  await database.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",
    [eventId, eventId, room, externalUserId]
  );
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (sql, values) => inner.query(sql, values), execute: (sql, values) => inner.execute(sql, values),
    verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, values) => transaction.query(sql, values),
      execute: async (sql, values) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic operation notice audit failure");
        return transaction.execute(sql, values);
      }
    }))
  };
}

try {
  const service = new OperationNoticeService(database);
  const reader = new OperationNoticeReader(database);
  if (!restart) {
    const operatorId = 988700001;
    await database.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (?,'synthetic-operation-notice','합성 공지 관리자','synthetic','active') ON DUPLICATE KEY UPDATE status='active'", [operatorId]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT ?,id FROM admin_roles WHERE code='super_admin' ON DUPLICATE KEY UPDATE role_id=VALUES(role_id)", [operatorId]);
    await database.execute("INSERT INTO external_identities(provider_code,external_user_id,status) VALUES ('kakao',?,'linked') ON DUPLICATE KEY UPDATE status='linked'", [externalUserId]);
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) SELECT ?,id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? ON DUPLICATE KEY UPDATE operator_id=VALUES(operator_id)", [operatorId, externalUserId]);

    const shadowEvent = `${eventPrefix}-shadow`;
    await event(shadowEvent);
    const shadow = await new CommandDispatcher(new MariaCommandDispatchRepository(database), { enabled: true, allowAllCanaries: true, canaryUserIds: new Set() }).resolve({ eventId: shadowEvent, message: "/정리알림", userId: externalUserId, hasTrustedDisplayName: true });
    assert.equal(shadow.route, "SHADOW");
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_key=?", [shadowEvent]), 0n);

    const cleanupEvent = `${eventPrefix}-cleanup`;
    await event(cleanupEvent);
    const cleanup = await service.handle({ externalUserId, channelId: room, message: "/정리알림 첫째\\n둘째", eventId: cleanupEvent });
    assert.equal(cleanup.action, "SET");
    assert.equal(cleanup.version, "2");
    const replay = await service.handle({ externalUserId, channelId: room, message: "/정리알림 다른 값", eventId: cleanupEvent });
    assert.deepEqual(replay, cleanup);

    const noOpEvent = `${eventPrefix}-noop`;
    await event(noOpEvent);
    const noOp = await service.handle({ externalUserId, channelId: room, message: "/정리알림 첫째/n둘째", eventId: noOpEvent });
    assert.equal(noOp.action, "NOOP");
    assert.equal(noOp.version, "2");

    const packageSet = `${eventPrefix}-package-set`;
    const packageClear = `${eventPrefix}-package-clear`;
    await event(packageSet); await event(packageClear);
    const setResult = await service.handle({ externalUserId, channelId: room, message: "/패키지알림 패키지 공지", eventId: packageSet });
    const clearResult = await service.handle({ externalUserId, channelId: room, message: "/패키지알림  ", eventId: packageClear });
    assert.deepEqual([setResult.version, clearResult.version, clearResult.action], ["3", "4", "CLEAR"]);

    const concurrentA = `${eventPrefix}-concurrent-a`;
    const concurrentB = `${eventPrefix}-concurrent-b`;
    await event(concurrentA); await event(concurrentB);
    await Promise.all([
      service.handle({ externalUserId, channelId: room, message: "/정리알림 동시 정리", eventId: concurrentA }),
      service.handle({ externalUserId, channelId: room, message: "/패키지알림 동시 패키지", eventId: concurrentB })
    ]);
    const pinned = await reader.readActiveSnapshot();
    assert.deepEqual(pinned, { version: "6", cleanup: "동시 정리", packageBag: "동시 패키지" });

    const rollbackEvent = `${eventPrefix}-rollback`;
    await event(rollbackEvent);
    await assert.rejects(() => new OperationNoticeService(failAudit(database)).handle({ externalUserId, channelId: room, message: "/정리알림 롤백 본문", eventId: rollbackEvent }), /synthetic operation notice audit failure/);
    assert.deepEqual(await reader.readActiveSnapshot(), pinned);
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_key=?", [rollbackEvent]), 0n);
    const exposed = await count("SELECT COUNT(*) value FROM command_audit WHERE CAST(change_summary_json AS CHAR) LIKE '%동시 정리%' OR CAST(change_summary_json AS CHAR) LIKE '%동시 패키지%'");
    assert.equal(exposed, 0n);
    const effects = {
      operations: await count("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='operation.notice.mutate'"),
      versions: await count("SELECT COUNT(*) value FROM configuration_sets WHERE set_code='operation_notices'"),
      outboxes: await count("SELECT COUNT(*) value FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope='operation.notice.mutate'"),
      audits: await count("SELECT COUNT(*) value FROM command_audit audit JOIN operations operation_row ON operation_row.id=audit.operation_id WHERE operation_row.idempotency_scope='operation.notice.mutate'")
    };
    assert.deepEqual(effects, { operations: 6n, versions: 6n, outboxes: 6n, audits: 6n });
    console.log(JSON.stringify({ mode: "probe", migrationCount: 242, scenarios: ["shadow", "normalize", "empty-clear", "same-value-noop", "concurrent-head-lock", "redacted-audit", "replay", "rollback", "pinned-reader"], effects, pinned, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? Number(value) : value));
  } else {
    const before = await reader.readActiveSnapshot();
    const operations = await count("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='operation.notice.mutate'");
    const replay = await service.handle({ externalUserId, channelId: room, message: "/정리알림 재시작 변경 시도", eventId: `${eventPrefix}-cleanup` });
    assert.equal(replay.version, "2");
    assert.deepEqual(await reader.readActiveSnapshot(), before);
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='operation.notice.mutate'"), operations);
    console.log(JSON.stringify({ mode: "verify-restart", operations, version: before.version, additionalMutation: false, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? Number(value) : value));
  }
} finally {
  await database.close();
}
