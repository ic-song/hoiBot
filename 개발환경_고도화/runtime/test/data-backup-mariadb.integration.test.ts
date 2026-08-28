import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { DataBackupService } from "../src/admin/data-backup-service.js";
import { loadConfig } from "../src/config.js";
import {
  createDatabaseClient,
  type DatabaseClient,
  type DatabaseTransaction,
} from "../src/database.js";
import {
  CommandDispatcher,
  MariaCommandDispatchRepository,
} from "../src/dispatch/command-dispatcher.js";

const integration =
  process.env.RUN_MARIADB_INTEGRATION === "true" ? describe : describe.skip;

integration("admin data backup MariaDB integration", () => {
  let db: DatabaseClient;
  const user = "integration-data-backup-master";
  const room = "integration-data-backup-room";
  const prefix = `integration-data-backup-${Date.now()}`;
  const memberFile = `${prefix}-member.json`;
  const notesFile = `${prefix}-notes.txt`;
  const staleFile = `${prefix}-stale-only.json`;

  before(async () => {
    db = createDatabaseClient(loadConfig().database);
    const op = 988700007;
    await db.execute(
      "INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (?,'integration-data-backup','통합 데이터백업 마스터','integration','active') ON DUPLICATE KEY UPDATE status='active'",
      [op],
    );
    await db.execute(
      "INSERT INTO admin_operator_roles(operator_id,role_id) SELECT ?,id FROM admin_roles WHERE code='super_admin' ON DUPLICATE KEY UPDATE role_id=VALUES(role_id)",
      [op],
    );
    await db.execute(
      "INSERT INTO external_identities(provider_code,external_user_id,status) VALUES('kakao',?,'linked') ON DUPLICATE KEY UPDATE status='linked'",
      [user],
    );
    await db.execute(
      "INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) SELECT ?,id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? ON DUPLICATE KEY UPDATE operator_id=VALUES(operator_id)",
      [op, user],
    );
    await object(db, "prod", memberFile, '{"member":1}');
    await object(db, "prod", notesFile, "일반 텍스트");
    await object(db, "dev", staleFile, "stale");
  });

  after(async () => db.close());

  async function event(id: string, external = user) {
    await db.execute(
      "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES(?,?,?,?,'message','incoming',REPEAT('e',64),'processed',UTC_TIMESTAMP(3))",
      [id, id, room, external],
    );
  }

  async function count(sql: string, values: readonly unknown[] = []) {
    const rows = await db.query<Array<{ value: bigint | string }>>(sql, values);
    return BigInt(rows[0]?.value ?? 0);
  }

  it("copies one pinned source atomically and preserves stale DEV files, replay, Shadow and rollback", async () => {
    const service = new DataBackupService(db);
    const shadowId = `${prefix}-shadow`;
    await event(shadowId);
    const shadow = await new CommandDispatcher(
      new MariaCommandDispatchRepository(db),
      { enabled: true, allowAllCanaries: true, canaryUserIds: new Set() },
    ).resolve({
      eventId: shadowId,
      message: "dev/데이터백업",
      userId: user,
      hasTrustedDisplayName: true,
    });
    assert.deepEqual([shadow.route, shadow.handlerKey], [
      "SHADOW",
      "admin_data_backup",
    ]);

    const prodFiles = (
      await db.query<Array<{ file_name: string }>>(
        "SELECT file_name FROM managed_data_objects WHERE environment_code='prod' ORDER BY file_name",
      )
    ).map((row) => row.file_name);
    const devFilesBefore = (
      await db.query<Array<{ file_name: string }>>(
        "SELECT file_name FROM managed_data_objects WHERE environment_code='dev' ORDER BY file_name",
      )
    ).map((row) => row.file_name);
    const expectedDevFiles = new Set([...prodFiles, ...devFilesBefore]);

    const readId = `${prefix}-run`;
    await event(readId);
    const result = await service.backup({
      eventId: readId,
      externalUserId: user,
      destinationId: room,
    });
    assert.ok(result !== null);
    assert.deepEqual(result.copiedFiles, prodFiles);
    assert.ok(result.copiedFiles.includes(memberFile));
    assert.ok(result.copiedFiles.includes(notesFile));
    assert.equal(
      await count(
        "SELECT COUNT(*) value FROM managed_data_objects WHERE environment_code='dev'",
      ),
      BigInt(expectedDevFiles.size),
    );
    assert.equal(
      await count("SELECT COUNT(*) value FROM backup_manifest WHERE run_id=?", [
        result.runId,
      ]),
      BigInt(prodFiles.length),
    );

    const beforeReplay = await db.query<Array<{ revision_version: bigint }>>(
      "SELECT revision_version FROM managed_data_objects WHERE environment_code='dev' AND file_name=?",
      [memberFile],
    );
    assert.deepEqual(
      await service.backup({
        eventId: readId,
        externalUserId: user,
        destinationId: room,
      }),
      result,
    );
    const afterReplay = await db.query<Array<{ revision_version: bigint }>>(
      "SELECT revision_version FROM managed_data_objects WHERE environment_code='dev' AND file_name=?",
      [memberFile],
    );
    assert.equal(
      afterReplay[0]?.revision_version.toString(),
      beforeReplay[0]?.revision_version.toString(),
    );

    const denied = `${prefix}-denied`;
    await event(denied, `${user}-denied`);
    assert.equal(
      await service.backup({
        eventId: denied,
        externalUserId: `${user}-denied`,
        destinationId: room,
      }),
      null,
    );

    const rollbackFile = `${prefix}-rollback.txt`;
    await object(db, "prod", rollbackFile, "rollback-source");
    const rollback = `${prefix}-rollback`;
    await event(rollback);
    await assert.rejects(
      () =>
        new DataBackupService(failAudit(db)).backup({
          eventId: rollback,
          externalUserId: user,
          destinationId: room,
        }),
      /integration data backup audit failure/,
    );
    assert.equal(
      await count(
        "SELECT COUNT(*) value FROM managed_data_objects WHERE environment_code='dev' AND file_name=?",
        [rollbackFile],
      ),
      0n,
    );
    assert.equal(
      await count("SELECT COUNT(*) value FROM operations WHERE idempotency_key=?", [
        rollback,
      ]),
      0n,
    );
  });
});

async function object(
  db: DatabaseClient,
  environment: string,
  name: string,
  payload: string,
) {
  const hash = createHash("sha256").update(payload).digest("hex");
  const size = Buffer.byteLength(payload, "utf8");
  await db.execute(
    "INSERT INTO managed_data_objects(environment_code,file_name,payload_text,content_sha256,size_bytes,revision_version,modified_at) VALUES(?,?,?,?,?,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE payload_text=VALUES(payload_text),content_sha256=VALUES(content_sha256),size_bytes=VALUES(size_bytes),revision_version=revision_version+1,modified_at=UTC_TIMESTAMP(3)",
    [environment, name, payload, hash, size],
  );
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
            if (sql.includes("INSERT INTO command_audit")) {
              throw new Error("integration data backup audit failure");
            }
            return tx.execute(sql, values);
          },
        }),
      ),
  };
}
