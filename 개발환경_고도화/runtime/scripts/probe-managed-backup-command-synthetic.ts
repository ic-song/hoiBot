import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../src/dispatch/command-dispatcher.js";
import { ManagedBackupCommandService } from "../src/admin/managed-backup-command-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_admin_backup_command(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error("Synthetic managed-backup probe blocked: " + config.database.name);
}
const db = createDatabaseClient(config.database);
const restart = process.argv.includes("--verify-restart");
const user = "synthetic-managed-backup-master";
const room = "synthetic-managed-backup-room";
const prefix = process.env.MANAGED_BACKUP_PROBE_EVENT_ID ?? "managed-backup-g7-20260829-r1";

try {
  const service = new ManagedBackupCommandService(db);
  if (!restart) {
    await seedAdmin();
    const targets = await db.query<Array<{ file_name: string }>>("SELECT file_name FROM managed_backup_targets WHERE active=TRUE ORDER BY sort_order");
    for (const target of targets.slice(0, -1)) await managed(target.file_name, JSON.stringify({ file: target.file_name }));

    const shadowId = prefix + "-shadow";
    await event(shadowId);
    const shadow = await new CommandDispatcher(new MariaCommandDispatchRepository(db), { enabled: true, allowAllCanaries: true, canaryUserIds: new Set() }).resolve({ eventId: shadowId, message: "/백업", userId: user, hasTrustedDisplayName: true });
    assert.deepEqual([shadow.route, shadow.handlerKey], ["SHADOW", "admin_managed_backup"]);

    const runId = prefix + "-run";
    await event(runId);
    const result = await service.backup({ eventId: runId, externalUserId: user, destinationId: room });
    assert.ok(result !== null);
    assert.equal(result.targetCount, targets.length);
    assert.equal(result.presentFiles.length, targets.length - 1);
    assert.equal(result.missingFiles.length, 1);
    assert.deepEqual(await service.backup({ eventId: runId, externalUserId: user, destinationId: room }), result);

    const concurrentId = prefix + "-concurrent";
    await event(concurrentId);
    const concurrent = await Promise.all([
      service.backup({ eventId: concurrentId, externalUserId: user, destinationId: room }),
      service.backup({ eventId: concurrentId, externalUserId: user, destinationId: room }),
    ]);
    assert.deepEqual(concurrent[0], concurrent[1]);

    const deniedId = prefix + "-denied";
    await event(deniedId, user + "-denied");
    assert.equal(await service.backup({ eventId: deniedId, externalUserId: user + "-denied", destinationId: room }), null);

    const rollbackId = prefix + "-rollback";
    await event(rollbackId);
    await assert.rejects(
      () => new ManagedBackupCommandService(failAudit(db)).backup({ eventId: rollbackId, externalUserId: user, destinationId: room }),
      /synthetic managed backup audit failure/,
    );
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_key=?", [rollbackId]), 0n);

    console.log(JSON.stringify({
      mode: "probe",
      migrationCount: 318,
      targetCount: targets.length,
      presentCount: result.presentFiles.length,
      missingCount: result.missingFiles.length,
      scenarios: ["exact-dispatch", "shadow", "super-admin", "verified-manifest", "missing-explicit", "replay", "concurrency", "rollback"],
      runId: result.runId,
      sourceRevisionKey: result.sourceRevisionKey,
      operationalDataTouched: false,
    }));
  } else {
    const before = await count("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='managed_backup.execute'");
    const result = await service.backup({ eventId: prefix + "-run", externalUserId: user, destinationId: room });
    assert.ok(result !== null);
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='managed_backup.execute'"), before);
    console.log(JSON.stringify({ mode: "verify-restart", runId: result.runId, sourceRevisionKey: result.sourceRevisionKey, replayPreserved: true, operations: Number(before), additionalMutation: false, operationalDataTouched: false }));
  }
} finally {
  await db.close();
}

async function seedAdmin() {
  const operatorId = 988700010;
  await db.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (?,'synthetic-managed-backup','합성 운영백업 마스터','synthetic','active') ON DUPLICATE KEY UPDATE status='active'", [operatorId]);
  await db.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT ?,id FROM admin_roles WHERE code='super_admin' ON DUPLICATE KEY UPDATE role_id=VALUES(role_id)", [operatorId]);
  await db.execute("INSERT INTO external_identities(provider_code,external_user_id,status) VALUES('kakao',?,'linked') ON DUPLICATE KEY UPDATE status='linked'", [user]);
  await db.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) SELECT ?,id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? ON DUPLICATE KEY UPDATE operator_id=VALUES(operator_id)", [operatorId, user]);
}

async function event(id: string, external = user) {
  await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES(?,?,?,?,'message','incoming',REPEAT('c',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [id, id, room, external]);
}

async function managed(fileName: string, payload: string) {
  const hash = createHash("sha256").update(payload).digest("hex");
  await db.execute("INSERT INTO managed_data_objects(environment_code,file_name,payload_text,content_sha256,size_bytes,revision_version,modified_at) VALUES('prod',?,?,?,?,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE payload_text=VALUES(payload_text),content_sha256=VALUES(content_sha256),size_bytes=VALUES(size_bytes),revision_version=revision_version+1,modified_at=UTC_TIMESTAMP(3)", [fileName, payload, hash, Buffer.byteLength(payload, "utf8")]);
}

async function count(sql: string, values: readonly unknown[] = []) {
  return BigInt((await db.query<Array<{ value: bigint | string }>>(sql, values))[0]?.value ?? 0);
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
            if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic managed backup audit failure");
            return tx.execute(sql, values);
          },
        }),
      ),
  };
}
