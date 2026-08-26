import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PendantDurabilityCorrectionService } from "../src/pet/pendant-durability-correction-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_pendant_durability_correction(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic pendant durability probe blocked: ${config.database.name}`);
const base = process.env.PENDANT_DURABILITY_CORRECTION_PROBE_EVENT_ID ?? "pendant-durability-correction-g7-20260827-r1";
const restart = process.argv.includes("--verify-restart");
const db = createDatabaseClient(config.database);
const room = "synthetic-pendant-durability-room";
const master = "pendant-durability-master";
const manager = "pendant-durability-manager";

// command execution 외래 키용 비식별 합성 event를 준비합니다.
async function event(id: string, user: string): Promise<void> {
  await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [id, id, room, user]);
}

// 감사 기록 직전 실패를 주입해 instance와 correction 원장의 rollback을 검증합니다.
function failAudit(inner: DatabaseClient): DatabaseClient {
  return { ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params),
    verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, params) => transaction.query(sql, params), execute: async (sql, params) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic pendant durability audit failure");
        return transaction.execute(sql, params);
      }
    })) };
}

async function snapshot(): Promise<Array<{ ownedDurability: string; ownedVersion: bigint; equippedDurability: string; equippedVersion: bigint; projectionDurability: bigint; operations: bigint; outboxes: bigint; corrections: bigint; audits: bigint }>> {
  return db.query(`SELECT
    (SELECT JSON_UNQUOTE(JSON_EXTRACT(attributes_json,'$.durability')) FROM inventory_instances WHERE id=988100001) ownedDurability,
    (SELECT version FROM inventory_instances WHERE id=988100001) ownedVersion,
    (SELECT JSON_UNQUOTE(JSON_EXTRACT(attributes_json,'$.durability')) FROM inventory_instances WHERE id=988100002) equippedDurability,
    (SELECT version FROM inventory_instances WHERE id=988100002) equippedVersion,
    (SELECT durability FROM player_pet_pendants WHERE player_pet_id=988000001) projectionDurability,
    (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pendant.durability.correct') operations,
    (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope='pendant.durability.correct') outboxes,
    (SELECT COUNT(*) FROM pendant_durability_corrections) corrections,
    (SELECT COUNT(*) FROM command_audit WHERE action_code='pet.pendant.durability.correct') audits`);
}

try {
  const ownedEvent = `${base}-owned`;
  if (restart) {
    const before = await snapshot();
    const result = await new PendantDurabilityCorrectionService(db).handle({ eventId: ownedEvent, externalUserId: master, destinationId: room, message: "/펜던트내구도수정 대상 남, 1, 999999999999999999999" });
    assert.equal(result.status, "changed");
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(before[0], { ownedDurability: "5", ownedVersion: 2n, equippedDurability: "2", equippedVersion: 2n, projectionDurability: 2n, operations: 3n, outboxes: 3n, corrections: 2n, audits: 3n });
    process.stdout.write(JSON.stringify({ mode: "verify-restart", operations: 3, outboxes: 3, corrections: 2, additionalMutation: false, operationalDataTouched: false }) + "\n");
  } else {
    await db.execute("INSERT INTO players(id,status) VALUES (988000000,'active'),(988000001,'active'),(988000002,'active')");
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (988000000,'총괄 남'),(988000001,'대상 남'),(988000002,'운영 여')");
    await db.execute("INSERT INTO external_identities(id,provider_code,external_user_id,player_id,status) VALUES (988200000,'kakao',?,988000000,'linked'),(988200002,'kakao',?,988000002,'linked')", [master, manager]);
    await db.execute("INSERT INTO player_pets(id,player_id,display_name) VALUES (988000001,988000001,'대상 펫')");
    await db.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (988300000,'pendant-durability-master','총괄 남','synthetic','active'),(988300002,'pendant-durability-manager','운영 여','synthetic','active')");
    await db.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (988300000,988200000),(988300002,988200002)");
    await db.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT 988300000,id FROM admin_roles WHERE code='super_admin'");
    await db.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT 988300002,id FROM admin_roles WHERE code='manager'");
    await db.execute("INSERT INTO item_definitions(id,code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES (988400001,'PENDANT-DURABILITY-OWNED','합성가방펜던트','ITEM',0,JSON_OBJECT('objectType','pendant'),1,1),(988400002,'PENDANT-DURABILITY-EQUIPPED','합성장착펜던트','ITEM',0,JSON_OBJECT('objectType','pendant'),1,1)");
    await db.execute("INSERT INTO inventory_instances(id,player_id,item_id,status,attributes_json,version) VALUES (988100001,988000001,988400001,'owned',JSON_OBJECT('objectType','pendant','name','합성가방펜던트','icon','💎','grade','하급','durability',3,'maxDurability',5,'upgrade',6),1),(988100002,988000001,988400002,'equipped',JSON_OBJECT('objectType','pendant','name','합성장착펜던트','icon','🔷','grade','상급','durability',4,'maxDurability',5,'upgrade',1),1)");
    await db.execute("INSERT INTO player_pet_pendants(player_pet_id,inventory_instance_id,display_name,grade_code,grade_display_name,durability,max_durability,enhancement_level,raid_charm,castle_charm,version) VALUES (988000001,988100002,'합성장착펜던트','UPPER','상급',4,5,1,100000,100000,1)");
    assert.equal((await db.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='PENDANT_DURABILITY_CORRECTION'"))[0]!.rollout_state, "SHADOW");
    const service = new PendantDurabilityCorrectionService(db);
    await event(ownedEvent, master);
    const owned = await service.handle({ eventId: ownedEvent, externalUserId: master, destinationId: room, message: "/펜던트내구도수정 대상 남, 1, 999999999999999999999" });
    assert.equal(owned.status, "changed"); assert.equal(owned.beforeDurability, 3); assert.equal(owned.afterDurability, 5); assert.match(owned.data!, /⚒️5\/5/);
    assert.deepEqual(await service.handle({ eventId: ownedEvent, externalUserId: master, destinationId: room, message: "/펜던트내구도수정 대상 남, 1, 5" }), owned);
    const equippedEvent = `${base}-equipped`; await event(equippedEvent, master);
    const equipped = await service.handle({ eventId: equippedEvent, externalUserId: master, destinationId: room, message: "/펜던트내구도수정 대상 남, 0, 2" });
    assert.equal(equipped.status, "changed"); assert.equal(equipped.instanceId, "988100002");
    const usageEvent = `${base}-usage`; await event(usageEvent, master);
    assert.equal((await service.handle({ eventId: usageEvent, externalUserId: master, destinationId: room, message: "/펜던트내구도수정 대상 남 안내" })).status, "usage");
    const managerEvent = `${base}-manager`; await event(managerEvent, manager);
    assert.equal((await service.handle({ eventId: managerEvent, externalUserId: manager, destinationId: room, message: "/펜던트내구도수정 대상 남, 1, 3" })).status, "silent");
    const rollbackEvent = `${base}-rollback`; await event(rollbackEvent, master); const beforeRollback = await snapshot();
    await assert.rejects(() => new PendantDurabilityCorrectionService(failAudit(db)).handle({ eventId: rollbackEvent, externalUserId: master, destinationId: room, message: "/펜던트내구도수정 대상 남, 1, 4" }), /synthetic pendant durability audit failure/);
    assert.deepEqual(await snapshot(), beforeRollback); assert.equal(await db.verifyRollback(), true);
    const effects = await snapshot();
    assert.deepEqual(effects[0], { ownedDurability: "5", ownedVersion: 2n, equippedDurability: "2", equippedVersion: 2n, projectionDurability: 2n, operations: 3n, outboxes: 3n, corrections: 2n, audits: 3n });
    process.stdout.write(JSON.stringify({ mode: "probe", migrationCount: 123, scenarios: ["shadow-registry", "master-only", "owned-stable-index", "equipped-zero", "clamp-max", "usage", "replay", "rollback"], effects: effects[0], operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? Number(value) : value) + "\n");
  }
} finally { await db.close(); }
