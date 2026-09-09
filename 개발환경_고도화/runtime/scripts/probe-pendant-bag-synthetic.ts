import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PendantBagService } from "../src/pet/pendant-bag-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_pendant_bag(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic pendant bag probe blocked: ${config.database.name}`);
const base = process.env.PENDANT_BAG_PROBE_EVENT_ID ?? "pendant-bag-g7-20260827-r1";
const restart = process.argv.includes("--verify-restart");
const db = createDatabaseClient(config.database);
const service = new PendantBagService(db);

async function event(id: string, user: string): Promise<void> {
  await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,'synthetic-pendant-bag-room',?,'message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [id, id, user]);
}
function failAudit(inner: DatabaseClient): DatabaseClient { return { ping: () => inner.ping(), query: (s, p) => inner.query(s, p), execute: (s, p) => inner.execute(s, p), verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
  withTransaction: <T>(work: (t: DatabaseTransaction) => Promise<T>) => inner.withTransaction((t) => work({ query: (s, p) => t.query(s, p), execute: async (s, p) => { if (s.includes("INSERT INTO command_audit")) throw new Error("synthetic pendant bag audit failure"); return t.execute(s, p); } })) }; }

try {
  const success = `${base}-success`;
  if (restart) {
    const before = await db.query<Array<{ ops: bigint; outboxes: bigint; instances: bigint }>>("SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pendant.bag_read' AND idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes,(SELECT COUNT(*) FROM inventory_instances) instances", [success, success]);
    await service.read({ eventId: success, externalUserId: "pendant-master", destinationId: "synthetic-pendant-bag-room", message: "/펜던트가방 대상 여" });
    const after = await db.query<Array<{ ops: bigint; outboxes: bigint; instances: bigint }>>("SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pendant.bag_read' AND idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes,(SELECT COUNT(*) FROM inventory_instances) instances", [success, success]);
    assert.deepEqual(after, before); assert.deepEqual(after[0], { ops: 1n, outboxes: 1n, instances: 6n });
    process.stdout.write(JSON.stringify({ mode: "verify-restart", operationCount: 1, outboxCount: 1, instanceCount: 6, additionalMutation: false, operationalDataTouched: false }) + "\n");
  } else {
    const users = [[986000001, "pendant-self", "본인 남"], [986000002, "pendant-target", "대상 여"], [986000003, "pendant-master", "관리자 남"]] as const;
    for (const [id, external, name] of users) { await db.execute("INSERT INTO players(id,status) VALUES (?,'active')", [id]); await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,?)", [id, name]); await db.execute("INSERT INTO external_identities(provider_code,external_user_id,player_id,status) VALUES ('kakao',?,?,'linked')", [external, id]); await db.execute("INSERT INTO player_pets(id,player_id,display_name) VALUES (?,?,?)", [id, id, `${name}의 펫`]); }
    await db.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (986000002,'⭐',1)");
    await db.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (996000003,'pendant-master','관리자 남','synthetic-hash','active')");
    await db.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) SELECT 996000003,id FROM external_identities WHERE external_user_id='pendant-master'");
    await db.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT 996000003,id FROM admin_roles WHERE code='super_admin'");
    for (let index = 1; index <= 6; index++) {
      await db.execute("INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES (?,?, 'ITEM',0,JSON_OBJECT('objectType','pendant'),1,1)", [`PENDANT-SYN-${index}`, `합성펜던트${index}`]);
      await db.execute("INSERT INTO inventory_instances(player_id,item_id,status,attributes_json) SELECT 986000002,id,'owned',JSON_OBJECT('objectType','pendant','name',?,'icon','💎','grade',?,'durability',4,'maxDurability',5,'upgrade',2) FROM item_definitions WHERE code=?", [index === 1 ? "가" : `펜던트${index}`, index === 1 ? "창조" : "하급", `PENDANT-SYN-${index}`]);
    }
    assert.equal((await db.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='PENDANT_BAG_READ'"))[0]!.rollout_state, "SHADOW");
    const denied = `${base}-denied`; await event(denied, "pendant-self"); assert.deepEqual(await service.read({ eventId: denied, externalUserId: "pendant-self", destinationId: "synthetic-pendant-bag-room", message: "/펜던트가방 대상 여" }), { status: "silent", rowCount: 0 });
    await event(success, "pendant-master"); const result = await service.read({ eventId: success, externalUserId: "pendant-master", destinationId: "synthetic-pendant-bag-room", message: "/펜던트가방 대상 여" });
    assert.equal(result.status, "replied"); assert.equal(result.rowCount, 6); assert.match(result.data!, /^\[⭐대상 여\] 보유 펜던트가방💎\[6\/50\]/); assert.equal((result.data!.match(/\u200b/g) ?? []).length, 500); assert.ok(result.data!.indexOf("가💎[창조]") < result.data!.indexOf("펜던트2💎[하급]"));
    assert.deepEqual(await service.read({ eventId: success, externalUserId: "pendant-master", destinationId: "synthetic-pendant-bag-room", message: "/펜던트가방 대상 여" }), result);
    const rollback = `${base}-rollback`; await event(rollback, "pendant-master"); await assert.rejects(() => new PendantBagService(failAudit(db)).read({ eventId: rollback, externalUserId: "pendant-master", destinationId: "synthetic-pendant-bag-room", message: "/펜던트가방 대상 여" }), /synthetic pendant bag audit failure/);
    const effects = await db.query<Array<{ ops: bigint; outboxes: bigint; deniedOps: bigint; rollbackOps: bigint; instances: bigint }>>("SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes,(SELECT COUNT(*) FROM operations WHERE idempotency_key=?) deniedOps,(SELECT COUNT(*) FROM operations WHERE idempotency_key=?) rollbackOps,(SELECT COUNT(*) FROM inventory_instances) instances", [success, success, denied, rollback]);
    assert.deepEqual(effects[0], { ops: 1n, outboxes: 1n, deniedOps: 0n, rollbackOps: 0n, instances: 6n }); assert.equal(await db.verifyRollback(), true);
    process.stdout.write(JSON.stringify({ mode: "probe", migrationCount: 117, scenarios: ["shadow-registry", "self-boundary", "master-target", "stable-instance-order", "allsee", "silent-unauthorized", "replay", "rollback"], effects: { operation: 1, outbox: 1, deniedOperation: 0, rollbackOperation: 0, instances: 6 }, operationalDataTouched: false }) + "\n");
  }
} finally { await db.close(); }
