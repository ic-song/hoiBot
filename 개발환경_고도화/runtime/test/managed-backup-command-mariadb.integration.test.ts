import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../src/dispatch/command-dispatcher.js";
import { ManagedBackupCommandService } from "../src/admin/managed-backup-command-service.js";

const integration = process.env.RUN_MARIADB_INTEGRATION === "true" ? describe : describe.skip;

integration("admin managed backup command MariaDB integration", () => {
  let db: DatabaseClient;
  const user = "integration-managed-backup-master";
  const room = "integration-managed-backup-room";
  const prefix = "integration-managed-backup-" + Date.now();

  before(async () => {
    db = createDatabaseClient(loadConfig().database);
    const operatorId = 988700009;
    await db.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (?,'integration-managed-backup','통합 운영백업 마스터','integration','active') ON DUPLICATE KEY UPDATE status='active'", [operatorId]);
    await db.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT ?,id FROM admin_roles WHERE code='super_admin' ON DUPLICATE KEY UPDATE role_id=VALUES(role_id)", [operatorId]);
    await db.execute("INSERT INTO external_identities(provider_code,external_user_id,status) VALUES('kakao',?,'linked') ON DUPLICATE KEY UPDATE status='linked'", [user]);
    await db.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) SELECT ?,id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? ON DUPLICATE KEY UPDATE operator_id=VALUES(operator_id)", [operatorId, user]);
    const targets = await db.query<Array<{ file_name: string }>>("SELECT file_name FROM managed_backup_targets WHERE active=TRUE ORDER BY sort_order");
    for (const target of targets.slice(0, -1)) await managed(db, target.file_name, JSON.stringify({ file: target.file_name }));
  });

  after(async () => db.close());

  it("captures one verified manifest with replay, concurrency, authorization, Shadow and rollback", async () => {
    const service = new ManagedBackupCommandService(db);
    const targets = await db.query<Array<{ file_name: string }>>("SELECT file_name FROM managed_backup_targets WHERE active=TRUE ORDER BY sort_order");
    const shadowId = prefix + "-shadow";
    await event(db, shadowId, room, user);
    const shadow = await new CommandDispatcher(new MariaCommandDispatchRepository(db), { enabled: true, allowAllCanaries: true, canaryUserIds: new Set() }).resolve({ eventId: shadowId, message: "/백업", userId: user, hasTrustedDisplayName: true });
    assert.deepEqual([shadow.route, shadow.handlerKey], ["SHADOW", "admin_managed_backup"]);
    assert.equal(await count(db, "SELECT COUNT(*) value FROM operations WHERE idempotency_key=?", [shadowId]), 0n);

    const runId = prefix + "-run";
    await event(db, runId, room, user);
    const result = await service.backup({ eventId: runId, externalUserId: user, destinationId: room });
    assert.ok(result !== null);
    assert.equal(result.targetCount, targets.length);
    assert.equal(result.presentFiles.length, targets.length - 1);
    assert.deepEqual(result.missingFiles, [targets[targets.length - 1]!.file_name]);
    assert.equal(await count(db, "SELECT COUNT(*) value FROM managed_backup_manifest WHERE run_id=?", [result.runId]), BigInt(targets.length));
    assert.equal(await count(db, "SELECT COUNT(*) value FROM managed_backup_manifest WHERE run_id=? AND verification_status='verified'", [result.runId]), BigInt(targets.length - 1));
    assert.deepEqual(await service.backup({ eventId: runId, externalUserId: user, destinationId: room }), result);
    assert.equal(await count(db, "SELECT COUNT(*) value FROM managed_backup_runs WHERE id=?", [result.runId]), 1n);

    const concurrentId = prefix + "-concurrent";
    await event(db, concurrentId, room, user);
    const [left, right] = await Promise.all([
      service.backup({ eventId: concurrentId, externalUserId: user, destinationId: room }),
      service.backup({ eventId: concurrentId, externalUserId: user, destinationId: room }),
    ]);
    assert.deepEqual(left, right);
    assert.equal(await count(db, "SELECT COUNT(*) value FROM operations WHERE idempotency_scope='managed_backup.execute' AND idempotency_key=?", [concurrentId]), 1n);

    const deniedId = prefix + "-denied";
    await event(db, deniedId, room, user + "-denied");
    assert.equal(await service.backup({ eventId: deniedId, externalUserId: user + "-denied", destinationId: room }), null);
    assert.equal(await count(db, "SELECT COUNT(*) value FROM operations WHERE idempotency_key=?", [deniedId]), 0n);

    const rollbackId = prefix + "-rollback";
    await event(db, rollbackId, room, user);
    await assert.rejects(
      () => new ManagedBackupCommandService(failAudit(db)).backup({ eventId: rollbackId, externalUserId: user, destinationId: room }),
      /integration managed backup audit failure/,
    );
    assert.equal(await count(db, "SELECT COUNT(*) value FROM operations WHERE idempotency_key=?", [rollbackId]), 0n);
    assert.equal(await count(db, "SELECT COUNT(*) value FROM managed_backup_runs run JOIN operations operation ON operation.id=run.operation_id WHERE operation.idempotency_key=?", [rollbackId]), 0n);
  });
});

async function event(db: DatabaseClient, id: string, room: string, user: string) {
  await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES(?,?,?,?,'message','incoming',REPEAT('b',64),'processed',UTC_TIMESTAMP(3))", [id, id, room, user]);
}

async function managed(db: DatabaseClient, fileName: string, payload: string) {
  const hash = createHash("sha256").update(payload).digest("hex");
  await db.execute("INSERT INTO managed_data_objects(environment_code,file_name,payload_text,content_sha256,size_bytes,revision_version,modified_at) VALUES('prod',?,?,?,?,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE payload_text=VALUES(payload_text),content_sha256=VALUES(content_sha256),size_bytes=VALUES(size_bytes),revision_version=revision_version+1,modified_at=UTC_TIMESTAMP(3)", [fileName, payload, hash, Buffer.byteLength(payload, "utf8")]);
}

async function count(db: DatabaseClient, sql: string, values: readonly unknown[] = []) {
  const rows = await db.query<Array<{ value: bigint | string }>>(sql, values);
  return BigInt(rows[0]?.value ?? 0);
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(),
    query: (sql, values) => inner.query(sql, values),
    execute: (sql, values) => inner.execute(sql, values),
    verifyRollback: () => inner.verifyRollback(),
    close: async () => undefined,
    withTransaction: <T>(work: (tx: DatabaseTransaction) => Promise<T>) =>
      inner.withTransaction((tx) =>
        work({
          query: (sql, values) => tx.query(sql, values),
          execute: async (sql, values) => {
            if (sql.includes("INSERT INTO command_audit")) throw new Error("integration managed backup audit failure");
            return tx.execute(sql, values);
          },
        }),
      ),
  };
}
