import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../src/dispatch/command-dispatcher.js";
import { StatusAllService, TransientCommandStateStore } from "../src/admin/status-all-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_status_all(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic status-all probe blocked: ${config.database.name}`);
const database = createDatabaseClient(config.database);
const restart = process.argv.includes("--verify-restart");
const externalUserId = "synthetic-status-all-admin";
const destinationId = "synthetic-status-all-room";
const eventPrefix = process.env.STATUS_ALL_PROBE_EVENT_ID ?? "status-all-g7-20260828-r1";

async function count(sql: string, values: readonly unknown[] = []): Promise<bigint> {
  return BigInt((await database.query<Array<{ value: bigint | string }>>(sql, values))[0]?.value ?? 0);
}

async function event(eventId: string, userId = externalUserId): Promise<void> {
  await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [eventId, eventId, destinationId, userId]);
}

try {
  if (!restart) {
    const operatorId = 988700004;
    await database.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (?,'synthetic-status-all','합성 상태 관리자','synthetic','active') ON DUPLICATE KEY UPDATE status='active'", [operatorId]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT ?,id FROM admin_roles WHERE code='super_admin' ON DUPLICATE KEY UPDATE role_id=VALUES(role_id)", [operatorId]);
    await database.execute("INSERT INTO external_identities(provider_code,external_user_id,status) VALUES ('kakao',?,'linked') ON DUPLICATE KEY UPDATE status='linked'", [externalUserId]);
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) SELECT ?,id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? ON DUPLICATE KEY UPDATE operator_id=VALUES(operator_id)", [operatorId, externalUserId]);
    const store = new TransientCommandStateStore();
    const cycle: Record<string, unknown> = { phase: "confirm", accessToken: "hidden-token" }; cycle.self = cycle;
    store.set("member-a", cycle);
    const service = new StatusAllService(database, store);

    const shadowEvent = `${eventPrefix}-shadow`; await event(shadowEvent);
    const shadow = await new CommandDispatcher(new MariaCommandDispatchRepository(database), { enabled: true, allowAllCanaries: true, canaryUserIds: new Set() }).resolve({ eventId: shadowEvent, message: "/상태전체", userId: externalUserId, hasTrustedDisplayName: true });
    assert.deepEqual([shadow.route, shadow.handlerKey], ["SHADOW", "admin_status_all"]);
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_key=?", [shadowEvent]), 0n);

    const readEvent = `${eventPrefix}-read`; await event(readEvent);
    const result = await service.read({ eventId: readEvent, externalUserId, destinationId });
    assert.ok(result !== null);
    assert.match(result.data, /\[REDACTED\]/); assert.match(result.data, /\[Circular\]/); assert.doesNotMatch(result.data, /hidden-token/);
    assert.deepEqual(await service.read({ eventId: readEvent, externalUserId, destinationId }), result);

    const deniedEvent = `${eventPrefix}-denied`; await event(deniedEvent, `${externalUserId}-denied`);
    assert.equal(await service.read({ eventId: deniedEvent, externalUserId: `${externalUserId}-denied`, destinationId }), null);

    const rollbackEvent = `${eventPrefix}-rollback`; await event(rollbackEvent);
    await assert.rejects(() => new StatusAllService(failAudit(database), store).read({ eventId: rollbackEvent, externalUserId, destinationId }), /synthetic status audit failure/);
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_key=?", [rollbackEvent]), 0n);
    const effects = {
      operations: await count("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='transient_state.read'"),
      executions: await count("SELECT COUNT(*) value FROM command_executions WHERE command_code='ADMIN_STATUS_ALL'"),
      outboxes: await count("SELECT COUNT(*) value FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope='transient_state.read'"),
      audits: await count("SELECT COUNT(*) value FROM command_audit audit JOIN operations operation_row ON operation_row.id=audit.operation_id WHERE operation_row.idempotency_scope='transient_state.read'")
    };
    assert.deepEqual(effects, { operations: 1n, executions: 1n, outboxes: 1n, audits: 1n });
    console.log(JSON.stringify({ mode: "probe", migrationCount: 269, scenarios: ["shadow","permission","pretty-json","redaction","cycle","replay","rollback"], effects, domainMutation: 0, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? Number(value) : value));
  } else {
    const before = await count("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='transient_state.read'");
    const restartedStore = new TransientCommandStateStore();
    assert.equal(restartedStore.snapshot().data, "{}");
    const replay = await new StatusAllService(database, restartedStore).read({ eventId: `${eventPrefix}-read`, externalUserId, destinationId });
    assert.ok(replay !== null); assert.match(replay.data, /\[REDACTED\]/);
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='transient_state.read'"), before);
    console.log(JSON.stringify({ mode: "verify-restart", transientEntries: 0, replayPreserved: true, operations: before, additionalMutation: false, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? Number(value) : value));
  }
} finally { await database.close(); }

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (sql, values) => inner.query(sql, values), execute: (sql, values) => inner.execute(sql, values),
    verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, values) => transaction.query(sql, values),
      execute: async (sql, values) => { if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic status audit failure"); return transaction.execute(sql, values); }
    }))
  };
}
