import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { BotRecoverySetService } from "../src/admin/bot-recovery-set-service.js";
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

integration("bot recovery set MariaDB integration", () => {
  let db: DatabaseClient;
  const user = "integration-bot-recovery-manager";
  const room = "integration-bot-recovery-room";
  const prefix = `integration-bot-recovery-${Date.now()}`;

  before(async () => {
    db = createDatabaseClient(loadConfig().database);
    const operator = 988700021;
    await db.execute(
      "INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (?,'integration-bot-recovery','통합 복구 운영자','integration','active') ON DUPLICATE KEY UPDATE status='active',display_name=VALUES(display_name)",
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

  it("restores one generation atomically with replay, reconnect, Shadow and rollback", async () => {
    const firstRevision = `${prefix}-first`;
    await generation(db, firstRevision, [
      ["member", '{"member":"restored"}'],
      ["member_pet", '{"member_pet":"restored"}'],
      ["petHomeActivityData", '{"home":"restored"}'],
    ]);
    await managed(db, "member.json", '{"member":"before"}');
    await managed(db, "member_pet.json", '{"member_pet":"before"}');
    await managed(db, "petHomeActivityData.json", '{"home":"before"}');

    const shadow = await new CommandDispatcher(
      new MariaCommandDispatchRepository(db),
      { enabled: true, allowAllCanaries: true, canaryUserIds: new Set() },
    ).resolve({
      eventId: `${prefix}-shadow`,
      message: "/봇살리기",
      userId: user,
      hasTrustedDisplayName: true,
    });
    assert.deepEqual([shadow.route, shadow.handlerKey], ["SHADOW", "bot_recovery_set"]);

    const service = new BotRecoverySetService(db);
    const eventId = `${prefix}-success`;
    const result = await service.restore({ externalUserId: user, channelId: room, eventId });
    assert.equal(result?.restored, true);
    assert.equal(result?.sourceRevisionKey, firstRevision);
    assert.deepEqual(result?.restoredTargets, ["member", "member_pet", "petHomeActivityData"]);
    assert.deepEqual(result?.skippedTargets, ["petSkillData"]);
    assert.equal(result?.data, "통합 복구 운영자님이 직전 데이터로 봇을 살립니다.");
    assert.equal(await payload(db, "member.json"), '{"member":"restored"}');
    assert.equal(await payload(db, "member_pet.json"), '{"member_pet":"restored"}');
    assert.equal(await payload(db, "petHomeActivityData.json"), '{"home":"restored"}');
    assert.equal(await count(db, "SELECT COUNT(*) value FROM bot_recovery_set_items WHERE operation_id=(SELECT id FROM operations WHERE idempotency_scope='bot_recovery_set.execute' AND idempotency_key=?)", [eventId]), 3n);

    assert.deepEqual(
      await service.restore({ externalUserId: user, channelId: room, eventId }),
      result,
    );
    await db.close();
    db = createDatabaseClient(loadConfig().database);
    assert.deepEqual(
      await new BotRecoverySetService(db).restore({ externalUserId: user, channelId: room, eventId }),
      result,
    );

    const rollbackRevision = `${prefix}-rollback`;
    await generation(db, rollbackRevision, [
      ["member", '{"member":"rollback"}'],
      ["member_pet", '{"member_pet":"rollback"}'],
      ["petHomeActivityData", '{"home":"rollback"}'],
      ["petSkillData", '{"skill":"rollback"}'],
    ]);
    await managed(db, "member.json", '{"member":"stable"}');
    await managed(db, "member_pet.json", '{"member_pet":"stable"}');
    await managed(db, "petHomeActivityData.json", '{"home":"stable"}');
    await managed(db, "petSkillData.json", '{"skill":"stable"}');
    const rollbackEvent = `${prefix}-rollback-event`;
    await assert.rejects(
      () => new BotRecoverySetService(failAudit(db)).restore({
        externalUserId: user,
        channelId: room,
        eventId: rollbackEvent,
      }),
      /integration bot recovery audit failure/,
    );
    assert.equal(await payload(db, "member.json"), '{"member":"stable"}');
    assert.equal(await payload(db, "member_pet.json"), '{"member_pet":"stable"}');
    assert.equal(await payload(db, "petHomeActivityData.json"), '{"home":"stable"}');
    assert.equal(await payload(db, "petSkillData.json"), '{"skill":"stable"}');
    assert.equal(await count(db, "SELECT COUNT(*) value FROM operations WHERE idempotency_scope='bot_recovery_set.execute' AND idempotency_key=?", [rollbackEvent]), 0n);
  });
});

async function generation(
  db: DatabaseClient,
  revision: string,
  entries: Array<[string, string]>,
) {
  const created = await db.execute(
    "INSERT INTO backup_generations(environment_code,revision_key,generation_status,created_at,completed_at) VALUES ('prod',?,'complete',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [revision],
  );
  for (const [target, value] of entries) {
    const hash = createHash("sha256").update(value).digest("hex");
    const size = Buffer.byteLength(value, "utf8");
    const object = await db.execute(
      "INSERT INTO backup_objects(generation_id,target_code,slot_code,object_exists,content_sha256,size_bytes,modified_at,storage_locator) VALUES (?,?,'backup1',TRUE,?,?,UTC_TIMESTAMP(3),'synthetic')",
      [created.insertId, target, hash, size],
    );
    await db.execute(
      "INSERT INTO backup_health_checks(backup_object_id,valid_json,error_code,checked_at) VALUES (?,TRUE,NULL,UTC_TIMESTAMP(3))",
      [object.insertId],
    );
    await db.execute(
      "INSERT INTO backup_object_payloads(backup_object_id,payload_text,content_sha256,size_bytes,captured_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))",
      [object.insertId, value, hash, size],
    );
  }
}

async function managed(db: DatabaseClient, name: string, value: string) {
  const hash = createHash("sha256").update(value).digest("hex");
  const size = Buffer.byteLength(value, "utf8");
  await db.execute(
    "INSERT INTO managed_data_objects(environment_code,file_name,payload_text,content_sha256,size_bytes,revision_version,modified_at) VALUES ('prod',?,?,?,?,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE payload_text=VALUES(payload_text),content_sha256=VALUES(content_sha256),size_bytes=VALUES(size_bytes),revision_version=revision_version+1,modified_at=UTC_TIMESTAMP(3)",
    [name, value, hash, size],
  );
}

async function payload(db: DatabaseClient, name: string): Promise<string> {
  const rows = await db.query<Array<{ payload_text: string }>>(
    "SELECT payload_text FROM managed_data_objects WHERE environment_code='prod' AND file_name=?",
    [name],
  );
  return rows[0]!.payload_text;
}

async function count(
  db: DatabaseClient,
  sql: string,
  values: readonly unknown[] = [],
): Promise<bigint> {
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
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) =>
      inner.withTransaction((transaction) =>
        work({
          query: (sql, values) => transaction.query(sql, values),
          execute: async (sql, values) => {
            if (sql.includes("INSERT INTO command_audit")) {
              throw new Error("integration bot recovery audit failure");
            }
            return transaction.execute(sql, values);
          },
        }),
      ),
  };
}
