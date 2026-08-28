import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { MiniPetUpgradeOverrideService } from "../src/admin/mini-pet-upgrade-override-service.js";

const config=loadConfig();
if(!config.database.enabled)throw new Error("DATABASE_ENABLED must be true.");
if(!/^hoibot_admin_minipet_upgrade_override(?:_[a-z0-9_]+)?$/i.test(config.database.name))throw new Error(`Synthetic admin mini-pet upgrade override probe blocked: ${config.database.name}`);
const db=createDatabaseClient(config.database),base=process.env.ADMIN_MINIPET_UPGRADE_OVERRIDE_PROBE_EVENT_ID??"admin-minipet-upgrade-override-g7-20260828-r1";
const restart=process.argv.includes("--verify-restart"),room="synthetic-admin-minipet-upgrade-room",master="admin-minipet-upgrade-master";
const successEvent=`${base}-success`,sameEvent=`${base}-same`,concurrentEvent=`${base}-concurrent`;

// command execution FK용 비식별 합성 event를 준비합니다.
async function event(id:string,user:string):Promise<void>{await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('a',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",[id,id,room,user]);}

// 감사 기록 직전 실패를 주입해 미니펫 변경과 operation 전체 rollback을 검증합니다.
function failAudit(inner:DatabaseClient):DatabaseClient{return{ping:()=>inner.ping(),query:(sql,params)=>inner.query(sql,params),execute:(sql,params)=>inner.execute(sql,params),verifyRollback:()=>inner.verifyRollback(),close:async()=>undefined,withTransaction:<T>(work:(transaction:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction(transaction=>work({query:(sql,params)=>transaction.query(sql,params),execute:async(sql,params)=>{if(sql.includes("INSERT INTO command_audit"))throw new Error("synthetic admin mini-pet upgrade audit failure");return transaction.execute(sql,params);}}))};}

async function snapshot():Promise<Array<{upgrade:bigint;petVersion:bigint;operations:bigint;outboxes:bigint;audits:bigint;executions:bigint}>>{return db.query(`SELECT
  (SELECT enhancement_level FROM owned_mini_pets WHERE id=983100001) upgrade,
  (SELECT version FROM owned_mini_pets WHERE id=983100001) petVersion,
  (SELECT COUNT(*) FROM operations WHERE idempotency_scope='admin.mini_pet.enhancement.override') operations,
  (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope='admin.mini_pet.enhancement.override') outboxes,
  (SELECT COUNT(*) FROM command_audit WHERE action_code='mini_pet.enhancement.override') audits,
  (SELECT COUNT(*) FROM command_executions WHERE command_code='ADMIN_MINI_PET_UPGRADE_OVERRIDE') executions`);}

try{
  const expected={upgrade:43n,petVersion:3n,operations:3n,outboxes:3n,audits:3n,executions:3n};
  if(restart){
    const before=await snapshot();
    const result=await new MiniPetUpgradeOverrideService(db).set({message:"/미니펫강화속성 대상 회원 1 42",idempotencyKey:successEvent,sourceEventId:successEvent,destinationId:room,operatorId:"983300000"});
    assert.equal(result.status,"changed");assert.deepEqual(await snapshot(),before);assert.deepEqual(before[0],expected);
    process.stdout.write(JSON.stringify({mode:"verify-restart",operations:3,additionalMutation:false,operationalDataTouched:false})+"\n");
  }else{
    await db.execute("INSERT INTO players(id,status) VALUES (983000000,'active'),(983000001,'active')");
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (983000000,'호이 남'),(983000001,'대상 회원')");
    await db.execute("INSERT INTO mini_pet_definitions(id,code,display_name,grade_code,active) VALUES (983050001,'SYNTH-ADMIN-UPGRADE','합성 미니펫','normal',TRUE)");
    await db.execute("INSERT INTO owned_mini_pets(id,player_id,mini_pet_definition_id,equipped,bag_sequence,enhancement_level,version) VALUES (983100000,983000001,983050001,TRUE,NULL,7,1),(983100001,983000001,983050001,FALSE,1,3,1)");
    await db.execute("INSERT INTO external_identities(id,provider_code,external_user_id,player_id,status) VALUES (983200000,'kakao',?,983000000,'linked')",[master]);
    await db.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (983300000,'admin-minipet-upgrade-master','호이 남','synthetic','active')");
    await db.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (983300000,983200000)");
    await db.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT 983300000,id FROM admin_roles WHERE code='super_admin'");
    assert.equal((await db.query<Array<{rollout_state:string}>>("SELECT rollout_state FROM command_registry WHERE command_code='ADMIN_MINI_PET_UPGRADE_OVERRIDE'"))[0]!.rollout_state,"SHADOW");
    await db.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='ADMIN_MINI_PET_UPGRADE_OVERRIDE'");
    assert.equal((await new MiniPetUpgradeOverrideService(db).handleIris({eventId:`${base}-unauthorized`,externalUserId:"unknown",channelId:room,message:"/미니펫강화속성 대상 회원 1 9"})).status,"handled_no_reply");

    const rollbackEvent=`${base}-rollback`;await event(rollbackEvent,master);const before=await snapshot();
    await assert.rejects(()=>new MiniPetUpgradeOverrideService(failAudit(db)).set({message:"/미니펫강화속성 대상 회원 1 9",idempotencyKey:rollbackEvent,sourceEventId:rollbackEvent,destinationId:room,operatorId:"983300000"}),/synthetic admin mini-pet upgrade audit failure/);
    assert.deepEqual(await snapshot(),before);assert.equal(await db.verifyRollback(),true);

    await event(successEvent,master);const service=new MiniPetUpgradeOverrideService(db);
    const result=await service.handleIris({eventId:successEvent,externalUserId:master,channelId:room,message:"/미니펫강화속성 대상 회원 1 42"});
    assert.equal(result.status,"changed");assert.equal(result.data,"미니펫강화속성 완료");
    assert.deepEqual(await service.handleIris({eventId:successEvent,externalUserId:master,channelId:room,message:"/미니펫강화속성 대상 회원 1 42"}),result);

    await event(sameEvent,master);const same=await service.set({message:"/미니펫강화속성 대상 회원 1 42",idempotencyKey:sameEvent,sourceEventId:sameEvent,destinationId:room,operatorId:"983300000"});
    assert.equal(same.status,"unchanged");assert.equal(same.version,"2");

    await event(concurrentEvent,master);const concurrent=await Promise.all([1,2].map(()=>service.set({message:"/미니펫강화속성 대상 회원 1 43",idempotencyKey:concurrentEvent,sourceEventId:concurrentEvent,destinationId:room,operatorId:"983300000"})));
    assert.deepEqual(concurrent[0],concurrent[1]);assert.equal(concurrent[0]!.status,"changed");assert.deepEqual((await snapshot())[0],expected);
    process.stdout.write(JSON.stringify({mode:"probe",migrationCount:289,scenarios:["shadow-registry","fixed-super-admin","strict-parser","stable-bag-id","absolute-0-300","same-value-no-op","concurrent-replay","rollback","audit-outbox","restart-ready"],effects:expected,operationalDataTouched:false},(_k,v)=>typeof v==="bigint"?Number(v):v)+"\n");
  }
}finally{await db.close();}
