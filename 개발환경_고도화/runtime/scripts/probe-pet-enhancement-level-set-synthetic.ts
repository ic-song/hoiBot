import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction, type DatabaseWriteResult } from "../src/database.js";
import { PetEnhancementLevelSetService } from "../src/admin/pet-enhancement-level-set-service.js";

const config=loadConfig();
if(!config.database.enabled)throw new Error("DATABASE_ENABLED must be true.");
if(!/^hoibot_pet_upgrade_attribute(?:_[a-z0-9_]+)?$/i.test(config.database.name))throw new Error(`Synthetic pet enhancement level probe is blocked for database: ${config.database.name}`);
const base=process.env.PET_UPGRADE_ATTRIBUTE_PROBE_EVENT_ID??"pet-upgrade-attribute-g7-20260827-r1";
const restart=process.argv.includes("--verify-restart");
const database=createDatabaseClient(config.database);
const service=new PetEnhancementLevelSetService(database);

async function event(id:string,user:string):Promise<void>{await database.execute(`INSERT INTO event_inbox
  (event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at)
  VALUES (?,?,'synthetic-pet-upgrade-attribute-room',?,'message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3))
  ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)`,[id,id,user]);}

async function fixtures():Promise<void>{
  for(const id of [983000001,983000002,983000003,983000004])await database.execute("INSERT INTO players(id,status) VALUES (?,'active') ON DUPLICATE KEY UPDATE status=VALUES(status)",[id]);
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (983000001,'강화속성대상'),(983000004,'펫없는대상') ON DUPLICATE KEY UPDATE current_display_name=VALUES(current_display_name)");
  await database.execute("INSERT INTO player_pets(id,player_id,display_name,enhancement_level) VALUES (983000001,983000001,'합성펫',3) ON DUPLICATE KEY UPDATE enhancement_level=3,version=1");
  await database.execute(`INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES
    (993000001,983000002,'kakao','pet-upgrade-attribute-master','합성 총괄 운영자','linked'),
    (993000002,983000003,'kakao','pet-upgrade-attribute-manager','합성 운영자','linked')
    ON DUPLICATE KEY UPDATE status='linked'`);
  await database.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (963000001,'pet-upgrade-attribute-master','총괄 운영자','synthetic','active'),(963000002,'pet-upgrade-attribute-manager','운영자','synthetic','active') ON DUPLICATE KEY UPDATE status='active'");
  await database.execute("INSERT IGNORE INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (963000001,993000001),(963000002,993000002)");
  await database.execute("INSERT IGNORE INTO admin_operator_roles(operator_id,role_id) SELECT 963000001,id FROM admin_roles WHERE code='super_admin'");
  await database.execute("INSERT IGNORE INTO admin_operator_roles(operator_id,role_id) SELECT 963000002,id FROM admin_roles WHERE code='manager'");
}

function failOn(inner:DatabaseClient,needle:string,versionConflict=false):DatabaseClient{return{ping:()=>inner.ping(),query:(s,p)=>inner.query(s,p),execute:(s,p)=>inner.execute(s,p),verifyRollback:()=>inner.verifyRollback(),close:async()=>undefined,
  withTransaction:<T>(work:(t:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction(t=>work({query:(s,p)=>t.query(s,p),execute:async(s,p):Promise<DatabaseWriteResult>=>{if(versionConflict&&s.startsWith("UPDATE player_pets"))return{affectedRows:0n,insertId:0n};if(s.includes(needle))throw new Error(`synthetic failure: ${needle}`);return t.execute(s,p);}}))};}

try{
  const successEvent=`${base}-success`;
  if(restart){
    const before=await database.query<Array<{level:bigint;version:bigint;ops:bigint;outboxes:bigint}>>(`SELECT enhancement_level level,version,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='admin.pet_enhancement.set:963000001' AND idempotency_key=?) ops,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes
      FROM player_pets WHERE id=983000001`,[successEvent,successEvent]);
    const replay=await service.handleIris({externalUserId:"pet-upgrade-attribute-master",channelId:"synthetic-pet-upgrade-attribute-room",message:"/펫강화속성 강화속성대상 42",eventId:successEvent});
    const after=await database.query<typeof before>(`SELECT enhancement_level level,version,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='admin.pet_enhancement.set:963000001' AND idempotency_key=?) ops,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes
      FROM player_pets WHERE id=983000001`,[successEvent,successEvent]);
    assert.equal(replay.status,"changed");assert.deepEqual(after,before);assert.deepEqual(after[0],{level:42n,version:2n,ops:1n,outboxes:1n});
    process.stdout.write(JSON.stringify({mode:"verify-restart",level:42,version:2,operationCount:1,outboxCount:1,additionalMutation:false})+"\n");
  }else{
    await fixtures();
    for(const [suffix,user] of [["shadow","pet-upgrade-attribute-master"],["usage","pet-upgrade-attribute-master"],["success","pet-upgrade-attribute-master"],["denied","pet-upgrade-attribute-manager"],["missing","pet-upgrade-attribute-master"],["version","pet-upgrade-attribute-master"],["rollback","pet-upgrade-attribute-master"]])await event(`${base}-${suffix}`,user);
    const shadow=await service.handleIris({externalUserId:"pet-upgrade-attribute-master",channelId:"synthetic-pet-upgrade-attribute-room",message:"/펫강화속성 강화속성대상 42",eventId:`${base}-shadow`});assert.equal(shadow.status,"shadow");
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='ADMIN_PET_ENHANCEMENT_SET'");
    const usage=await service.handleIris({externalUserId:"pet-upgrade-attribute-master",channelId:"synthetic-pet-upgrade-attribute-room",message:"/펫강화속성 강화속성대상",eventId:`${base}-usage`});assert.equal(usage.status,"changed");if(usage.status==="changed")assert.equal(usage.data,"올바른 명령어 형식을 사용해주세요. 예: /펫강화속성 [유저명] [강화수]");
    const success=await service.handleIris({externalUserId:"pet-upgrade-attribute-master",channelId:"synthetic-pet-upgrade-attribute-room",message:"/펫강화속성 강화속성대상 42",eventId:successEvent});assert.equal(success.status,"changed");if(success.status==="changed")assert.equal(success.data,"펫강화속성 완료");
    const replay=await service.handleIris({externalUserId:"pet-upgrade-attribute-master",channelId:"synthetic-pet-upgrade-attribute-room",message:"/펫강화속성 강화속성대상 42",eventId:successEvent});assert.deepEqual(replay,success);
    const denied=await service.handleIris({externalUserId:"pet-upgrade-attribute-manager",channelId:"synthetic-pet-upgrade-attribute-room",message:"/펫강화속성 강화속성대상 99",eventId:`${base}-denied`});assert.equal(denied.status,"handled_no_reply");
    const missing=await service.handleIris({externalUserId:"pet-upgrade-attribute-master",channelId:"synthetic-pet-upgrade-attribute-room",message:"/펫강화속성 펫없는대상 7",eventId:`${base}-missing`});assert.equal(missing.status,"changed");if(missing.status==="changed")assert.equal(missing.data,"펫이 없습니다.");
    await assert.rejects(()=>new PetEnhancementLevelSetService(failOn(database,"never",true)).set({message:"/펫강화속성 강화속성대상 77",idempotencyKey:`${base}-version`,sourceEventId:`${base}-version`,destinationId:"synthetic-pet-upgrade-attribute-room",operatorId:"963000001"}),/version conflict/);
    await assert.rejects(()=>new PetEnhancementLevelSetService(failOn(database,"INSERT INTO command_audit")).set({message:"/펫강화속성 강화속성대상 88",idempotencyKey:`${base}-rollback`,sourceEventId:`${base}-rollback`,destinationId:"synthetic-pet-upgrade-attribute-room",operatorId:"963000001"}),/synthetic failure/);
    const effects=await database.query<Array<{level:bigint;version:bigint;successOps:bigint;successOutboxes:bigint;deniedOps:bigint;versionOps:bigint;rollbackOps:bigint}>>(`SELECT enhancement_level level,version,
      (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) successOps,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) successOutboxes,
      (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) deniedOps,
      (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) versionOps,
      (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) rollbackOps FROM player_pets WHERE id=983000001`,[successEvent,successEvent,`${base}-denied`,`${base}-version`,`${base}-rollback`]);
    assert.deepEqual(effects[0],{level:42n,version:2n,successOps:1n,successOutboxes:1n,deniedOps:0n,versionOps:0n,rollbackOps:0n});assert.equal(await database.verifyRollback(),true);
    process.stdout.write(JSON.stringify({mode:"probe",scenarios:["shadow","usage","success","replay","permission-denied","missing-pet","version-conflict","audit-rollback"],effects:{level:42,version:2,successOperation:1,successOutbox:1,deniedOperation:0,versionOperation:0,rollbackOperation:0},operationalDataTouched:false})+"\n");
  }
}finally{await database.close();}
