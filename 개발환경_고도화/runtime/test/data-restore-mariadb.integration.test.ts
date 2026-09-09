import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { DataRestoreService } from "../src/admin/data-restore-service.js";
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

integration("admin data restore MariaDB integration", () => {
  let db: DatabaseClient;
  const user = "integration-data-restore-manager";
  const room = "integration-data-restore-room";
  const prefix = `integration-data-restore-${Date.now()}`;

  before(async () => {
    db = createDatabaseClient(loadConfig().database);
    const operator = 988700009;
    await db.execute(
      "INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (?,'integration-data-restore','통합 데이터복구 운영자','integration','active') ON DUPLICATE KEY UPDATE status='active'",
      [operator],
    );
    await db.execute(
      "INSERT INTO admin_operator_roles(operator_id,role_id) SELECT ?,id FROM admin_roles WHERE code='manager' ON DUPLICATE KEY UPDATE role_id=VALUES(role_id)",
      [operator],
    );
    await db.execute(
      "INSERT INTO external_identities(provider_code,external_user_id,status) VALUES('kakao',?,'linked') ON DUPLICATE KEY UPDATE status='linked'",
      [user],
    );
    await db.execute(
      "INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) SELECT ?,id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? ON DUPLICATE KEY UPDATE operator_id=VALUES(operator_id)",
      [operator, user],
    );
  });

  after(async () => db.close());

  async function event(id: string, external = user) {
    await db.execute(
      "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES(?,?,?,?,'message','incoming',REPEAT('d',64),'processed',UTC_TIMESTAMP(3))",
      [id, id, room, external],
    );
  }

  async function count(sql: string, values: readonly unknown[] = []) {
    const rows = await db.query<Array<{ value: bigint | string }>>(sql, values);
    return BigInt(rows[0]?.value ?? 0);
  }

  it("restores one immutable generation with snapshot, replay, Shadow and rollback", async () => {
    const service = new DataRestoreService(db);
    const restoredPayload = '{"member":"restored"}';
    await source(db, "prod", `${prefix}-revision`, "member", "backup1", restoredPayload);
    await managed(db, "prod", "member.json", '{"member":"current"}');

    const shadowId = `${prefix}-shadow`;
    await event(shadowId);
    const shadow = await new CommandDispatcher(
      new MariaCommandDispatchRepository(db),
      { enabled: true, allowAllCanaries: true, canaryUserIds: new Set() },
    ).resolve({
      eventId: shadowId,
      message: "/데이터복구",
      userId: user,
      hasTrustedDisplayName: true,
    });
    assert.deepEqual([shadow.route, shadow.handlerKey], [
      "SHADOW",
      "admin_data_restore",
    ]);

    const runId = `${prefix}-run`;
    await event(runId);
    const result = await service.restore({
      eventId: runId,
      externalUserId: user,
      destinationId: room,
      command: { environment: "prod", target: "member", generation: 1 },
    });
    assert.ok(result?.restored);
    const target = (
      await db.query<Array<{ payload_text: string; revision_version: bigint }>>(
        "SELECT payload_text,revision_version FROM managed_data_objects WHERE environment_code='prod' AND file_name='member.json'",
      )
    )[0]!;
    assert.equal(target.payload_text, restoredPayload);
    assert.equal(
      await count(
        "SELECT COUNT(*) value FROM restore_operations restore_row JOIN operations operation_row ON operation_row.id=restore_row.operation_id WHERE operation_row.idempotency_key=?",
        [runId],
      ),
      1n,
    );
    assert.equal(
      await count(
        "SELECT COUNT(*) value FROM restore_snapshots snapshot JOIN restore_operations restore_row ON restore_row.id=snapshot.restore_operation_id JOIN operations operation_row ON operation_row.id=restore_row.operation_id WHERE operation_row.idempotency_key=?",
        [runId],
      ),
      1n,
    );
    const snapshot = (
      await db.query<Array<{ payload_text: string }>>(
        "SELECT snapshot.payload_text FROM restore_snapshots snapshot JOIN restore_operations restore_row ON restore_row.id=snapshot.restore_operation_id JOIN operations operation_row ON operation_row.id=restore_row.operation_id WHERE operation_row.idempotency_key=?",
        [runId],
      )
    )[0]!;
    assert.equal(snapshot.payload_text, '{"member":"current"}');

    assert.deepEqual(
      await service.restore({
        eventId: runId,
        externalUserId: user,
        destinationId: room,
        command: { environment: "prod", target: "member", generation: 1 },
      }),
      result,
    );
    const replay = (
      await db.query<Array<{ revision_version: bigint }>>(
        "SELECT revision_version FROM managed_data_objects WHERE environment_code='prod' AND file_name='member.json'",
      )
    )[0]!;
    assert.equal(replay.revision_version.toString(), target.revision_version.toString());

    const denied = `${prefix}-denied`;
    await event(denied, `${user}-denied`);
    assert.equal(
      await service.restore({
        eventId: denied,
        externalUserId: `${user}-denied`,
        destinationId: room,
        command: { environment: "prod", target: "member", generation: 1 },
      }),
      null,
    );

    const rollbackPayload = '{"member_pet":"rollback-source"}';
    await source(
      db,
      "prod",
      `${prefix}-rollback-revision`,
      "member_pet",
      "backup1",
      rollbackPayload,
    );
    await managed(db, "prod", "member_pet.json", '{"member_pet":"before"}');
    const rollback = `${prefix}-rollback`;
    await event(rollback);
    await assert.rejects(
      () =>
        new DataRestoreService(failAudit(db)).restore({
          eventId: rollback,
          externalUserId: user,
          destinationId: room,
          command: {
            environment: "prod",
            target: "member_pet",
            generation: 1,
          },
        }),
      /integration data restore audit failure/,
    );
    const afterRollback = (
      await db.query<Array<{ payload_text: string }>>(
        "SELECT payload_text FROM managed_data_objects WHERE environment_code='prod' AND file_name='member_pet.json'",
      )
    )[0]!;
    assert.equal(afterRollback.payload_text, '{"member_pet":"before"}');
    assert.equal(
      await count("SELECT COUNT(*) value FROM operations WHERE idempotency_key=?", [
        rollback,
      ]),
      0n,
    );
  });
});

async function source(
  db: DatabaseClient,
  environment: string,
  revision: string,
  target: string,
  slot: string,
  payload: string,
) {
  const hash = createHash("sha256").update(payload).digest("hex");
  const size = Buffer.byteLength(payload, "utf8");
  const generation = await db.execute(
    "INSERT INTO backup_generations(environment_code,revision_key,generation_status,created_at,completed_at) VALUES (?,?,'complete',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [environment, revision],
  );
  const object = await db.execute(
    "INSERT INTO backup_objects(generation_id,target_code,slot_code,object_exists,content_sha256,size_bytes,modified_at,storage_locator) VALUES (?,?,?,TRUE,?,?,UTC_TIMESTAMP(3),'synthetic')",
    [generation.insertId, target, slot, hash, size],
  );
  await db.execute(
    "INSERT INTO backup_health_checks(backup_object_id,valid_json,error_code,checked_at) VALUES (?,TRUE,NULL,UTC_TIMESTAMP(3))",
    [object.insertId],
  );
  await db.execute(
    "INSERT INTO backup_object_payloads(backup_object_id,payload_text,content_sha256,size_bytes,captured_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))",
    [object.insertId, payload, hash, size],
  );
}

async function managed(
  db: DatabaseClient,
  environment: string,
  name: string,
  payload: string,
) {
  const hash = createHash("sha256").update(payload).digest("hex");
  const size = Buffer.byteLength(payload, "utf8");
  await db.execute(
    "INSERT INTO managed_data_objects(environment_code,file_name,payload_text,content_sha256,size_bytes,revision_version,modified_at) VALUES (?,?,?,?,?,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE payload_text=VALUES(payload_text),content_sha256=VALUES(content_sha256),size_bytes=VALUES(size_bytes),revision_version=revision_version+1,modified_at=UTC_TIMESTAMP(3)",
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
              throw new Error("integration data restore audit failure");
            }
            return tx.execute(sql, values);
          },
        }),
      ),
  };
}
