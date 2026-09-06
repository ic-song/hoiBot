import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../src/dispatch/command-dispatcher.js";
import { StatusAllService, TransientCommandStateStore } from "../src/admin/status-all-service.js";

const integration = process.env.RUN_MARIADB_INTEGRATION === "true" ? describe : describe.skip;

integration("admin status all MariaDB integration", () => {
  let database: DatabaseClient;
  const externalUserId = "integration-status-all-admin";
  const destinationId = "integration-status-all-room";
  const prefix = `integration-status-all-${Date.now()}`;

  before(async () => {
    database = createDatabaseClient(loadConfig().database);
    const operatorId = 988700003;
    await database.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (?,'integration-status-all','통합 상태 관리자','integration','active') ON DUPLICATE KEY UPDATE status='active'", [operatorId]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT ?,id FROM admin_roles WHERE code='super_admin' ON DUPLICATE KEY UPDATE role_id=VALUES(role_id)", [operatorId]);
    await database.execute("INSERT INTO external_identities(provider_code,external_user_id,status) VALUES ('kakao',?,'linked') ON DUPLICATE KEY UPDATE status='linked'", [externalUserId]);
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) SELECT ?,id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? ON DUPLICATE KEY UPDATE operator_id=VALUES(operator_id)", [operatorId, externalUserId]);
  });

  after(async () => database.close());

  async function event(eventId: string, userId = externalUserId): Promise<void> {
    await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3))", [eventId, eventId, destinationId, userId]);
  }

  async function count(sql: string, values: readonly unknown[] = []): Promise<bigint> {
    return BigInt((await database.query<Array<{ value: bigint | string }>>(sql, values))[0]?.value ?? 0);
  }

  it("preserves permission, replay, LEGACY_ONLY fallback, rollback and restart-loss contracts", async () => {
    const store = new TransientCommandStateStore();
    store.set("member", { phase: "pending", password: "must-not-leak" });
    const service = new StatusAllService(database, store);
    const shadowEvent = `${prefix}-shadow`; await event(shadowEvent);
    const shadow = await new CommandDispatcher(new MariaCommandDispatchRepository(database), { enabled: true, allowAllCanaries: true, canaryUserIds: new Set() }).resolve({ eventId: shadowEvent, message: "/상태전체", userId: externalUserId, hasTrustedDisplayName: true });
    assert.deepEqual([shadow.route, shadow.handlerKey], ["LEGACY_FALLBACK", "admin_status_all"]);

    const readEvent = `${prefix}-read`; await event(readEvent);
    const result = await service.read({ eventId: readEvent, externalUserId, destinationId });
    assert.ok(result !== null);
    assert.match(result.data, /\[REDACTED\]/);
    assert.doesNotMatch(result.data, /must-not-leak/);
    assert.deepEqual(await service.read({ eventId: readEvent, externalUserId, destinationId }), result);

    const deniedEvent = `${prefix}-denied`; await event(deniedEvent, `${externalUserId}-denied`);
    assert.equal(await service.read({ eventId: deniedEvent, externalUserId: `${externalUserId}-denied`, destinationId }), null);

    const rollbackEvent = `${prefix}-rollback`; await event(rollbackEvent);
    await assert.rejects(() => new StatusAllService(failAudit(database), store).read({ eventId: rollbackEvent, externalUserId, destinationId }), /integration status audit failure/);
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_key=?", [rollbackEvent]), 0n);

    const restarted = new TransientCommandStateStore();
    assert.equal(restarted.snapshot().data, "{}");
    assert.deepEqual(await new StatusAllService(database, restarted).read({ eventId: readEvent, externalUserId, destinationId }), result);
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='transient_state.read' AND idempotency_key=?", [readEvent]), 1n);
  });
});

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (sql, values) => inner.query(sql, values), execute: (sql, values) => inner.execute(sql, values),
    verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, values) => transaction.query(sql, values),
      execute: async (sql, values) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("integration status audit failure");
        return transaction.execute(sql, values);
      }
    }))
  };
}
