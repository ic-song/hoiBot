import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PendantEnhanceCorrectionService } from "../src/pet/pendant-enhance-correction-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_pendant_enhance_correction(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic pendant correction probe blocked: ${config.database.name}`);
const base = process.env.PENDANT_ENHANCE_CORRECTION_PROBE_EVENT_ID ?? "pendant-enhance-correction-g7-20260827-r1";
const restart = process.argv.includes("--verify-restart");
const db = createDatabaseClient(config.database);
const room = "synthetic-pendant-correction-room";
const master = "pendant-correction-master";
const manager = "pendant-correction-manager";

// command execution 외래 키용 비식별 합성 event를 준비합니다.
async function event(id: string, user: string): Promise<void> {
  await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [id, id, room, user]);
}

// 감사 기록 직전 실패를 주입해 instance와 correction 원장의 rollback을 검증합니다.
function failAudit(inner: DatabaseClient): DatabaseClient {
  return { ping:()=>inner.ping(), query:(sql,params)=>inner.query(sql,params), execute:(sql,params)=>inner.execute(sql,params),
    verifyRollback:()=>inner.verifyRollback(), close:async()=>undefined,
    withTransaction:<T>(work:(transaction:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction((transaction)=>work({
      query:(sql,params)=>transaction.query(sql,params), execute:async(sql,params)=>{
        if(sql.includes("INSERT INTO command_audit")) throw new Error("synthetic pendant correction audit failure");
        return transaction.execute(sql,params);
      }
    })) };
}

async function snapshot(): Promise<Array<{ ownedLevel:string; ownedVersion:bigint; equippedLevel:string; equippedVersion:bigint; projectionLevel:bigint; operations:bigint; outboxes:bigint; corrections:bigint; audits:bigint }>> {
  return db.query(`SELECT
    (SELECT JSON_UNQUOTE(JSON_EXTRACT(attributes_json,'$.upgrade')) FROM inventory_instances WHERE id=989100001) ownedLevel,
    (SELECT version FROM inventory_instances WHERE id=989100001) ownedVersion,
    (SELECT JSON_UNQUOTE(JSON_EXTRACT(attributes_json,'$.upgrade')) FROM inventory_instances WHERE id=989100002) equippedLevel,
    (SELECT version FROM inventory_instances WHERE id=989100002) equippedVersion,
    (SELECT enhancement_level FROM player_pet_pendants WHERE player_pet_id=989000001) projectionLevel,
    (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pendant.enhancement.correct') operations,
    (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope='pendant.enhancement.correct') outboxes,
    (SELECT COUNT(*) FROM pendant_enhancement_corrections) corrections,
    (SELECT COUNT(*) FROM command_audit WHERE action_code='pet.pendant.enhancement.correct') audits`);
}

try {
  const ownedEvent=`${base}-owned`;
  if(restart){
    const before=await snapshot();
    const result=await new PendantEnhanceCorrectionService(db).handle({eventId:ownedEvent,externalUserId:master,destinationId:room,message:"/펜던트강화수정 대상 남, 1, 999999999999999999999"});
    assert.equal(result.status,"changed");
    assert.deepEqual(await snapshot(),before);
    assert.deepEqual(before[0],{ownedLevel:"30",ownedVersion:2n,equippedLevel:"2",equippedVersion:2n,projectionLevel:2n,operations:3n,outboxes:3n,corrections:2n,audits:3n});
    process.stdout.write(JSON.stringify({mode:"verify-restart",operations:3,outboxes:3,corrections:2,additionalMutation:false,operationalDataTouched:false})+"\n");
  } else {
    await db.execute("INSERT INTO players(id,status) VALUES (989000000,'active'),(989000001,'active'),(989000002,'active')");
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (989000000,'총괄 남'),(989000001,'대상 남'),(989000002,'운영 여')");
    await db.execute("INSERT INTO external_identities(id,provider_code,external_user_id,player_id,status) VALUES (989200000,'kakao',?,989000000,'linked'),(989200002,'kakao',?,989000002,'linked')",[master,manager]);
    await db.execute("INSERT INTO player_pets(id,player_id,display_name) VALUES (989000001,989000001,'대상 펫')");
    await db.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (989300000,'pendant-correction-master','총괄 남','synthetic','active'),(989300002,'pendant-correction-manager','운영 여','synthetic','active')");
    await db.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (989300000,989200000),(989300002,989200002)");
    await db.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT 989300000,id FROM admin_roles WHERE code='super_admin'");
    await db.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT 989300002,id FROM admin_roles WHERE code='manager'");
    await db.execute("INSERT INTO item_definitions(id,code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES (989400001,'PENDANT-CORRECTION-OWNED','합성가방펜던트','ITEM',0,JSON_OBJECT('objectType','pendant'),1,1),(989400002,'PENDANT-CORRECTION-EQUIPPED','합성장착펜던트','ITEM',0,JSON_OBJECT('objectType','pendant'),1,1)");
    await db.execute("INSERT INTO inventory_instances(id,player_id,item_id,status,attributes_json,version) VALUES (989100001,989000001,989400001,'owned',JSON_OBJECT('objectType','pendant','name','합성가방펜던트','icon','💎','grade','하급','durability',5,'maxDurability',5,'upgrade',6,'charm',100000,'explore',1),1),(989100002,989000001,989400002,'equipped',JSON_OBJECT('objectType','pendant','name','합성장착펜던트','icon','🔷','grade','상급','durability',4,'maxDurability',5,'upgrade',1,'charm',200000,'explore',2),1)");
    await db.execute("INSERT INTO player_pet_pendants(player_pet_id,inventory_instance_id,display_name,grade_code,grade_display_name,durability,max_durability,enhancement_level,raid_charm,castle_charm,version) VALUES (989000001,989100002,'합성장착펜던트','UPPER','상급',4,5,1,102500,102500,1)");
    assert.equal((await db.query<Array<{rollout_state:string}>>("SELECT rollout_state FROM command_registry WHERE command_code='PENDANT_ENHANCE_CORRECTION'"))[0]!.rollout_state,"SHADOW");
    const service=new PendantEnhanceCorrectionService(db);
    await event(ownedEvent,master);
    const owned=await service.handle({eventId:ownedEvent,externalUserId:master,destinationId:room,message:"/펜던트강화수정 대상 남, 1, 999999999999999999999"});
    assert.equal(owned.status,"changed"); assert.equal(owned.beforeLevel,6); assert.equal(owned.afterLevel,30); assert.match(owned.data!,/\(\+30\)$/);
    assert.deepEqual(await service.handle({eventId:ownedEvent,externalUserId:master,destinationId:room,message:"/펜던트강화수정 대상 남, 1, 30"}),owned);
    const equippedEvent=`${base}-equipped`; await event(equippedEvent,master);
    const equipped=await service.handle({eventId:equippedEvent,externalUserId:master,destinationId:room,message:"/펜던트강화수정 대상 남, 0, 2"});
    assert.equal(equipped.status,"changed"); assert.equal(equipped.instanceId,"989100002");
    const usageEvent=`${base}-usage`; await event(usageEvent,master);
    assert.equal((await service.handle({eventId:usageEvent,externalUserId:master,destinationId:room,message:"/펜던트강화수정 대상 남 안내"})).status,"usage");
    const managerEvent=`${base}-manager`; await event(managerEvent,manager);
    assert.equal((await service.handle({eventId:managerEvent,externalUserId:manager,destinationId:room,message:"/펜던트강화수정 대상 남, 1, 3"})).status,"silent");
    const rollbackEvent=`${base}-rollback`; await event(rollbackEvent,master); const beforeRollback=await snapshot();
    await assert.rejects(()=>new PendantEnhanceCorrectionService(failAudit(db)).handle({eventId:rollbackEvent,externalUserId:master,destinationId:room,message:"/펜던트강화수정 대상 남, 1, 4"}),/synthetic pendant correction audit failure/);
    assert.deepEqual(await snapshot(),beforeRollback); assert.equal(await db.verifyRollback(),true);
    const effects=await snapshot();
    assert.deepEqual(effects[0],{ownedLevel:"30",ownedVersion:2n,equippedLevel:"2",equippedVersion:2n,projectionLevel:2n,operations:3n,outboxes:3n,corrections:2n,audits:3n});
    process.stdout.write(JSON.stringify({mode:"probe",migrationCount:120,scenarios:["shadow-registry","master-only","owned-stable-index","equipped-zero","clamp-30","usage","replay","rollback"],effects:effects[0],operationalDataTouched:false},(_key,value)=>typeof value==="bigint"?Number(value):value)+"\n");
  }
} finally { await db.close(); }
