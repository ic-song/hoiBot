import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient,type DatabaseClient,type DatabaseTransaction } from "../src/database.js";
import { PendantRestoreService } from "../src/pet/pendant-restore-service.js";

const config=loadConfig(); if(!config.database.enabled)throw new Error("DATABASE_ENABLED must be true.");
if(!/^hoibot_pendant_restore(?:_[a-z0-9_]+)?$/i.test(config.database.name))throw new Error(`Synthetic pendant restore probe blocked: ${config.database.name}`);
const base=process.env.PENDANT_RESTORE_PROBE_EVENT_ID??"pendant-restore-g7-20260827-r1"; const restart=process.argv.includes("--verify-restart");
const db=createDatabaseClient(config.database); const room="synthetic-pendant-restore-room"; const user="pendant-restore-user";

// command execution 외래 키용 비식별 합성 event를 준비합니다.
async function event(id:string):Promise<void>{await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('a',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",[id,id,room,user]);}

// 감사 직전 실패로 instance·projection·복원석·ledger rollback을 검증합니다.
function failAudit(inner:DatabaseClient):DatabaseClient{return{ping:()=>inner.ping(),query:(sql,params)=>inner.query(sql,params),execute:(sql,params)=>inner.execute(sql,params),verifyRollback:()=>inner.verifyRollback(),close:async()=>undefined,withTransaction:<T>(work:(transaction:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction(transaction=>work({query:(sql,params)=>transaction.query(sql,params),execute:async(sql,params)=>{if(sql.includes("INSERT INTO command_audit"))throw new Error("synthetic pendant restore audit failure");return transaction.execute(sql,params);}}))};}

async function snapshot():Promise<Array<{owned:string;ownedVersion:bigint;equipped:string;equippedVersion:bigint;projection:bigint;rollbackPendant:string;stones:bigint;stoneVersion:bigint;operations:bigint;outboxes:bigint;restorations:bigint;audits:bigint;ledgers:bigint}>>{return db.query(`SELECT
 (SELECT JSON_UNQUOTE(JSON_EXTRACT(attributes_json,'$.durability')) FROM inventory_instances WHERE id=986100001) owned,(SELECT version FROM inventory_instances WHERE id=986100001) ownedVersion,
 (SELECT JSON_UNQUOTE(JSON_EXTRACT(attributes_json,'$.durability')) FROM inventory_instances WHERE id=986100002) equipped,(SELECT version FROM inventory_instances WHERE id=986100002) equippedVersion,
 (SELECT durability FROM player_pet_pendants WHERE player_pet_id=986000000) projection,
 (SELECT JSON_UNQUOTE(JSON_EXTRACT(attributes_json,'$.durability')) FROM inventory_instances WHERE id=986100004) rollbackPendant,
 (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=986000000 AND item.code='ITEM-PENDANT-RESTORE-STONE') stones,
 (SELECT stack.version FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=986000000 AND item.code='ITEM-PENDANT-RESTORE-STONE') stoneVersion,
 (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pendant.restore') operations,
 (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope='pendant.restore') outboxes,
 (SELECT COUNT(*) FROM pendant_restorations) restorations,(SELECT COUNT(*) FROM command_audit WHERE action_code LIKE 'pendant.restore%') audits,
 (SELECT COUNT(*) FROM inventory_ledger WHERE reason_code='PENDANT_RESTORE_STONE') ledgers`);}

try{
 const ownedEvent=`${base}-owned`;
 if(restart){const before=await snapshot();const result=await new PendantRestoreService(db).handle({eventId:ownedEvent,externalUserId:user,destinationId:room,message:"/펜던트복원 1"});assert.equal(result.status,"restored");assert.deepEqual(await snapshot(),before);assert.deepEqual(before[0],{owned:"5",ownedVersion:2n,equipped:"5",equippedVersion:2n,projection:5n,rollbackPendant:"2",stones:1n,stoneVersion:3n,operations:5n,outboxes:5n,restorations:2n,audits:5n,ledgers:2n});process.stdout.write(JSON.stringify({mode:"verify-restart",operations:5,restorations:2,additionalMutation:false,operationalDataTouched:false})+"\n");}
 else{
  await db.execute("INSERT INTO players(id,status) VALUES (986000000,'active')"); await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (986000000,'복원 남')");
  await db.execute("INSERT INTO external_identities(id,provider_code,external_user_id,player_id,status) VALUES (986200000,'kakao',?,986000000,'linked')",[user]); await db.execute("INSERT INTO player_pets(id,player_id,display_name) VALUES (986000000,986000000,'복원 펫')");
  const stone=(await db.query<Array<{id:bigint}>>("SELECT id FROM item_definitions WHERE code='ITEM-PENDANT-RESTORE-STONE'"))[0]; assert.ok(stone);
  await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (986000000,?,3,1)",[stone.id]);
  await db.execute("INSERT INTO item_definitions(id,code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES (986400001,'PENDANT-RESTORE-FIXTURE','합성복원펜던트','ITEM',0,JSON_OBJECT('objectType','pendant'),1,1)");
  await db.execute("INSERT INTO inventory_instances(id,player_id,item_id,status,attributes_json,version) VALUES (986100001,986000000,986400001,'owned',JSON_OBJECT('objectType','pendant','name','가가펜던트','grade','하급','durability',2,'maxDurability',5,'upgrade',1),1),(986100002,986000000,986400001,'equipped',JSON_OBJECT('objectType','pendant','name','장착펜던트','grade','상급','durability',1,'maxDurability',5,'upgrade',2),1),(986100003,986000000,986400001,'owned',JSON_OBJECT('objectType','pendant','name','나나펜던트','grade','하급','durability',5,'maxDurability',5,'upgrade',0),1),(986100004,986000000,986400001,'owned',JSON_OBJECT('objectType','pendant','name','다다펜던트','grade','하급','durability',2,'maxDurability',5,'upgrade',0),1)");
  await db.execute("INSERT INTO player_pet_pendants(player_pet_id,inventory_instance_id,display_name,grade_code,grade_display_name,durability,max_durability,enhancement_level,raid_charm,castle_charm,version) VALUES (986000000,986100002,'장착펜던트','UPPER','상급',1,5,2,100,100,1)");
  assert.equal((await db.query<Array<{rollout_state:string}>>("SELECT rollout_state FROM command_registry WHERE command_code='PENDANT_RESTORE'"))[0]!.rollout_state,"SHADOW"); const service=new PendantRestoreService(db);
  await event(ownedEvent);const owned=await service.handle({eventId:ownedEvent,externalUserId:user,destinationId:room,message:"/펜던트복원 1"});assert.equal(owned.status,"restored");assert.equal(owned.beforeDurability,2);assert.equal(owned.afterDurability,5);assert.deepEqual(await service.handle({eventId:ownedEvent,externalUserId:user,destinationId:room,message:"/펜던트복원 1"}),owned);
  const equippedEvent=`${base}-equipped`;await event(equippedEvent);assert.equal((await service.handle({eventId:equippedEvent,externalUserId:user,destinationId:room,message:"/펜던트복원 0"})).status,"restored");
  const maxEvent=`${base}-max`;await event(maxEvent);assert.equal((await service.handle({eventId:maxEvent,externalUserId:user,destinationId:room,message:"/펜던트복원 1"})).status,"rejected");
  await db.execute("UPDATE inventory_stacks SET quantity=0 WHERE player_id=986000000 AND item_id=?",[stone.id]);const noStoneEvent=`${base}-stone`;await event(noStoneEvent);assert.equal((await service.handle({eventId:noStoneEvent,externalUserId:user,destinationId:room,message:"/펜던트복원 3"})).status,"rejected");await db.execute("UPDATE inventory_stacks SET quantity=1 WHERE player_id=986000000 AND item_id=?",[stone.id]);
  const usageEvent=`${base}-usage`;await event(usageEvent);assert.equal((await service.handle({eventId:usageEvent,externalUserId:user,destinationId:room,message:"/펜던트복원 안내"})).status,"usage");
  const rollbackEvent=`${base}-rollback`;await event(rollbackEvent);const beforeRollback=await snapshot();await assert.rejects(()=>new PendantRestoreService(failAudit(db)).handle({eventId:rollbackEvent,externalUserId:user,destinationId:room,message:"/펜던트복원 3"}),/synthetic pendant restore audit failure/);assert.deepEqual(await snapshot(),beforeRollback);assert.equal(await db.verifyRollback(),true);
  const effects=await snapshot();assert.deepEqual(effects[0],{owned:"5",ownedVersion:2n,equipped:"5",equippedVersion:2n,projection:5n,rollbackPendant:"2",stones:1n,stoneVersion:3n,operations:5n,outboxes:5n,restorations:2n,audits:5n,ledgers:2n});
  process.stdout.write(JSON.stringify({mode:"probe",migrationCount:125,scenarios:["shadow-registry","owned","equipped-zero","already-max","stone-required","replay","usage","rollback"],effects:effects[0],operationalDataTouched:false},(_k,v)=>typeof v==="bigint"?Number(v):v)+"\n");
 }
}finally{await db.close();}
