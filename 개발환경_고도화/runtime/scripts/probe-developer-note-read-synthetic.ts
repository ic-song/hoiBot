import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../src/dispatch/command-dispatcher.js";
import { DeveloperNoteReadService } from "../src/admin/developer-note-read-service.js";

const database = createDatabaseClient(loadConfig().database);
const restart = process.argv.includes("--verify-restart");
const externalUserId = "synthetic-developer-note-admin";
const destinationId = "synthetic-developer-note-room";
const eventPrefix = "synthetic-developer-note";

async function count(sql: string, values: readonly unknown[] = []): Promise<bigint> {
  return BigInt((await database.query<Array<{ value: bigint | string }>>(sql, values))[0]?.value ?? 0);
}

async function event(eventId: string, userId = externalUserId): Promise<void> {
  await database.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",
    [eventId, eventId, destinationId, userId]
  );
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (sql, values) => inner.query(sql, values), execute: (sql, values) => inner.execute(sql, values),
    verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, values) => transaction.query(sql, values),
      execute: async (sql, values) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic developer note audit failure");
        return transaction.execute(sql, values);
      }
    }))
  };
}

try {
  const service = new DeveloperNoteReadService(database);
  if (!restart) {
    const operatorId = 988700002;
    await database.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (?,'synthetic-developer-note','합성 개발자노트 관리자','synthetic','active') ON DUPLICATE KEY UPDATE status='active'", [operatorId]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT ?,id FROM admin_roles WHERE code='super_admin' ON DUPLICATE KEY UPDATE role_id=VALUES(role_id)", [operatorId]);
    await database.execute("INSERT INTO external_identities(provider_code,external_user_id,status) VALUES ('kakao',?,'linked') ON DUPLICATE KEY UPDATE status='linked'", [externalUserId]);
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) SELECT ?,id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? ON DUPLICATE KEY UPDATE operator_id=VALUES(operator_id)", [operatorId, externalUserId]);

    for (let index = 0; index < 11; index += 1) {
      const version = `2.${(400 - index).toString()}`;
      const date = index < 2 ? "2026-08-28" : `2026-08-${(27 - index).toString().padStart(2, "0")}`;
      const inserted = await database.execute(
        "INSERT INTO developer_note_entries(version,released_on,entry_order,active) VALUES (?,?,?,TRUE)",
        [version, date, index + 1]
      );
      await database.execute(
        "INSERT INTO developer_note_changes(entry_id,change_index,change_text) VALUES (?,0,?)",
        [inserted.insertId, `변경 내용 ${index + 1}`]
      );
      if (index === 0) await database.execute(
        "INSERT INTO developer_note_changes(entry_id,change_index,change_text) VALUES (?,1,'첫 버전 두 번째 변경')",
        [inserted.insertId]
      );
    }

    const shadowEvent = `${eventPrefix}-shadow`;
    await event(shadowEvent);
    const shadow = await new CommandDispatcher(
      new MariaCommandDispatchRepository(database),
      { enabled: true, allowAllCanaries: true, canaryUserIds: new Set() }
    ).resolve({ eventId: shadowEvent, message: "/개발자노트", userId: externalUserId, hasTrustedDisplayName: true });
    assert.deepEqual([shadow.route, shadow.handlerKey], ["SHADOW", "admin_developer_note_read"]);
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_key=?", [shadowEvent]), 0n);

    const readEvent = `${eventPrefix}-read`;
    await event(readEvent);
    const result = await service.read({ eventId: readEvent, externalUserId, destinationId });
    assert.ok(result !== null);
    assert.deepEqual([result.entryCount, result.firstVersion, result.lastVersion], [10, "2.400", "2.391"]);
    assert.match(result.data, /ver_2\.400\n• 변경 내용 1\n• 첫 버전 두 번째 변경/);
    assert.equal((result.data.match(/📅 2026-08-28/g) ?? []).length, 1);
    assert.doesNotMatch(result.data, /ver_2\.390/);
    const replay = await service.read({ eventId: readEvent, externalUserId, destinationId });
    assert.deepEqual(replay, result);

    const concurrentA = `${eventPrefix}-concurrent-a`;
    const concurrentB = `${eventPrefix}-concurrent-b`;
    await event(concurrentA); await event(concurrentB);
    const concurrent = await Promise.all([
      service.read({ eventId: concurrentA, externalUserId, destinationId }),
      service.read({ eventId: concurrentB, externalUserId, destinationId })
    ]);
    assert.deepEqual(concurrent.map((entry) => entry?.data), [result.data, result.data]);

    const unauthorizedEvent = `${eventPrefix}-unauthorized`;
    await event(unauthorizedEvent, "synthetic-developer-note-unauthorized");
    assert.equal(await service.read({ eventId: unauthorizedEvent, externalUserId: "synthetic-developer-note-unauthorized", destinationId }), null);
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_key=?", [unauthorizedEvent]), 0n);

    const rollbackEvent = `${eventPrefix}-rollback`;
    await event(rollbackEvent);
    await assert.rejects(
      () => new DeveloperNoteReadService(failAudit(database)).read({ eventId: rollbackEvent, externalUserId, destinationId }),
      /synthetic developer note audit failure/
    );
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_key=?", [rollbackEvent]), 0n);
    assert.equal(await count("SELECT COUNT(*) value FROM developer_note_entries"), 11n);
    assert.equal(await count("SELECT COUNT(*) value FROM command_audit WHERE CAST(change_summary_json AS CHAR) LIKE '%변경 내용%'"), 0n);
    const effects = {
      operations: await count("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='developer_note.read'"),
      executions: await count("SELECT COUNT(*) value FROM command_executions WHERE command_code='ADMIN_DEVELOPER_NOTE_READ'"),
      outboxes: await count("SELECT COUNT(*) value FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope='developer_note.read'"),
      audits: await count("SELECT COUNT(*) value FROM command_audit audit JOIN operations operation_row ON operation_row.id=audit.operation_id WHERE operation_row.idempotency_scope='developer_note.read'")
    };
    assert.deepEqual(effects, { operations: 3n, executions: 3n, outboxes: 3n, audits: 3n });
    console.log(JSON.stringify({
      mode: "probe", migrationCount: 244,
      scenarios: ["shadow", "permission", "date-group", "entry-limit", "change-order", "replay", "concurrent-read", "redacted-audit", "rollback"],
      effects, noteEntries: 11, operationalDataTouched: false
    }, (_key, value) => typeof value === "bigint" ? Number(value) : value));
  } else {
    const beforeEntries = await count("SELECT COUNT(*) value FROM developer_note_entries");
    const beforeOperations = await count("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='developer_note.read'");
    const replay = await service.read({ eventId: `${eventPrefix}-read`, externalUserId, destinationId });
    assert.ok(replay !== null);
    assert.deepEqual([replay.entryCount, replay.firstVersion, replay.lastVersion], [10, "2.400", "2.391"]);
    assert.equal(await count("SELECT COUNT(*) value FROM developer_note_entries"), beforeEntries);
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='developer_note.read'"), beforeOperations);
    console.log(JSON.stringify({ mode: "verify-restart", entries: beforeEntries, operations: beforeOperations, additionalMutation: false, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? Number(value) : value));
  }
} finally {
  await database.close();
}
