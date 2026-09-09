import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { SpiritInfoService } from "../src/pet/spirit-info-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_spirit_info(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic spirit info probe blocked: ${config.database.name}`);
const base = process.env.SPIRIT_INFO_PROBE_EVENT_ID ?? "spirit-info-g7-20260827-r1";
const restart = process.argv.includes("--verify-restart");
const db = createDatabaseClient(config.database);
const service = new SpiritInfoService(db);

async function event(id: string, user: string): Promise<void> {
  await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,'synthetic-spirit-info-room',?,'message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [id, id, user]);
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return { ping: () => inner.ping(), query: (s, p) => inner.query(s, p), execute: (s, p) => inner.execute(s, p), verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (t: DatabaseTransaction) => Promise<T>) => inner.withTransaction((t) => work({ query: (s, p) => t.query(s, p), execute: async (s, p) => {
      if (s.includes("INSERT INTO command_audit")) throw new Error("synthetic spirit info audit failure");
      return t.execute(s, p);
    } })) };
}

try {
  const success = `${base}-success`;
  if (restart) {
    const before = await db.query<Array<{ ops: bigint; outboxes: bigint }>>("SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='spirit.info_read' AND idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes", [success, success]);
    await service.read({ eventId: success, externalUserId: "spirit-info-operator", destinationId: "synthetic-spirit-info-room" });
    const after = await db.query<Array<{ ops: bigint; outboxes: bigint }>>("SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='spirit.info_read' AND idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes", [success, success]);
    assert.deepEqual(after, before); assert.deepEqual(after[0], { ops: 1n, outboxes: 2n });
    process.stdout.write(JSON.stringify({ mode: "verify-restart", operationCount: 1, outboxCount: 2, additionalMutation: false, operationalDataTouched: false }) + "\n");
  } else {
    const operator = 984000001, outsider = 984000002;
    for (const [id, external, name] of [[operator, "spirit-info-operator", "호이 남"], [outsider, "spirit-info-outsider", "다른 사용자"]] as const) {
      await db.execute("INSERT INTO players(id,status) VALUES (?,'active')", [id]);
      await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,?)", [id, name]);
      await db.execute("INSERT INTO external_identities(provider_code,external_user_id,player_id,status) VALUES ('kakao',?,?,'linked')", [external, id]);
    }
    await db.execute("INSERT INTO player_pets(id,player_id,display_name) VALUES (?,?, '합성정령펫')", [operator, operator]);
    await db.execute("INSERT INTO player_pet_elementals(player_pet_id,display_name,grade_code,grade_display_name,enhancement_level) VALUES (?,'피닉스🐦‍🔥','ELEMENTAL-GRADE-007','정령왕',7)", [operator]);
    assert.equal((await db.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='SPIRIT_INFO_READ'"))[0]!.rollout_state, "SHADOW");
    const denied = `${base}-denied`; await event(denied, "spirit-info-outsider");
    assert.deepEqual(await service.read({ eventId: denied, externalUserId: "spirit-info-outsider", destinationId: "synthetic-spirit-info-room" }), { status: "silent", replies: [] });
    await event(success, "spirit-info-operator");
    const result = await service.read({ eventId: success, externalUserId: "spirit-info-operator", destinationId: "synthetic-spirit-info-room" });
    assert.equal(result.status, "replied"); assert.equal(result.replies.length, 2);
    assert.equal(result.replies[0]!.data, '{"upgrade":7,"name":"피닉스🐦‍🔥","grade":"정령왕"}');
    assert.equal(result.replies[1]!.data, '{"battleExp":8105,"raidExp":10175,"castleExp":8105,"message":""}');
    assert.deepEqual(await service.read({ eventId: success, externalUserId: "spirit-info-operator", destinationId: "synthetic-spirit-info-room" }), result);
    const rollback = `${base}-rollback`; await event(rollback, "spirit-info-operator");
    await assert.rejects(() => new SpiritInfoService(failAudit(db)).read({ eventId: rollback, externalUserId: "spirit-info-operator", destinationId: "synthetic-spirit-info-room" }), /synthetic spirit info audit failure/);
    const effects = await db.query<Array<{ ops: bigint; outboxes: bigint; deniedOps: bigint; rollbackOps: bigint }>>("SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes,(SELECT COUNT(*) FROM operations WHERE idempotency_key=?) deniedOps,(SELECT COUNT(*) FROM operations WHERE idempotency_key=?) rollbackOps", [success, success, denied, rollback]);
    assert.deepEqual(effects[0], { ops: 1n, outboxes: 2n, deniedOps: 0n, rollbackOps: 0n }); assert.equal(await db.verifyRollback(), true);
    process.stdout.write(JSON.stringify({ mode: "probe", migrationCount: 116, scenarios: ["shadow-registry", "exact-operator", "two-replies", "projection", "silent-unauthorized", "replay", "rollback"], effects: { operation: 1, outbox: 2, deniedOperation: 0, rollbackOperation: 0 }, operationalDataTouched: false }) + "\n");
  }
} finally { await db.close(); }
