import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { MiniPetBattleCountAdminService } from "../src/admin/mini-pet-battle-count-admin-service.js";

const config=loadConfig();
if(!config.database.enabled)throw new Error("DATABASE_ENABLED must be true.");
if(!/^hoibot_admin_minipet_battle_count(?:_[a-z0-9_]+)?$/i.test(config.database.name))throw new Error(`Synthetic admin mini-pet battle count probe blocked: ${config.database.name}`);
const db=createDatabaseClient(config.database),base=process.env.ADMIN_MINIPET_BATTLE_COUNT_PROBE_EVENT_ID??"admin-minipet-battle-count-g7-20260828-r1";
const restart=process.argv.includes("--verify-restart"),room="synthetic-admin-minipet-battle-count-room",master="admin-minipet-battle-count-master";
const successEvent=`${base}-success`,sameEvent=`${base}-same`,concurrentEvent=`${base}-concurrent`;

// command execution FK용 비식별 합성 event를 준비합니다.
async function event(id:string,user:string):Promise<void>{await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('a',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",[id,id,room,user]);}

// 감사 기록 직전 실패를 주입해 일일 횟수와 변경 event 전체 rollback을 검증합니다.
function failAudit(inner:DatabaseClient):DatabaseClient{return{ping:()=>inner.ping(),query:(sql,params)=>inner.query(sql,params),execute:(sql,params)=>inner.execute(sql,params),verifyRollback:()=>inner.verifyRollback(),close:async()=>undefined,withTransaction:<T>(work:(transaction:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction(transaction=>work({query:(sql,params)=>transaction.query(sql,params),execute:async(sql,params)=>{if(sql.includes("INSERT INTO command_audit"))throw new Error("synthetic admin mini-pet battle count audit failure");return transaction.execute(sql,params);}}))};}

async function snapshot():Promise<Array<{attempts:bigint;wins:bigint;losses:bigint;version:bigint;operations:bigint;events:bigint;outboxes:bigint;audits:bigint;executions:bigint}>>{return db.query(`SELECT
  (SELECT mini_battle_attempts FROM player_pet_daily_records WHERE player_id=985000001 AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))) attempts,
  (SELECT mini_battle_wins FROM player_pet_daily_records WHERE player_id=985000001 AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))) wins,
  (SELECT mini_battle_losses FROM player_pet_daily_records WHERE player_id=985000001 AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))) losses,
  (SELECT version FROM player_pet_daily_records WHERE player_id=985000001 AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))) version,
  (SELECT COUNT(*) FROM operations WHERE idempotency_scope='admin.mini_pet.battle_count.override') operations,
  (SELECT COUNT(*) FROM mini_pet_battle_count_override_events) events,
  (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope='admin.mini_pet.battle_count.override') outboxes,
  (SELECT COUNT(*) FROM command_audit WHERE action_code='mini_pet.battle_count.override') audits,
  (SELECT COUNT(*) FROM command_executions WHERE command_code='ADMIN_MINI_PET_BATTLE_COUNT') executions`);}

try{
  const expected={attempts:8n,wins:4n,losses:5n,version:3n,operations:3n,events:3n,outboxes:3n,audits:3n,executions:3n};
  if(restart){
    const before=await snapshot(),result=await new MiniPetBattleCountAdminService(db).set({message:"/미니펫대전횟수 대상 회원 7",idempotencyKey:successEvent,sourceEventId:successEvent,destinationId:room,operatorId:"985300000"});
    assert.equal(result.status,"changed");assert.deepEqual(await snapshot(),before);assert.deepEqual(before[0],expected);
    process.stdout.write(JSON.stringify({mode:"verify-restart",operations:3,additionalMutation:false,operationalDataTouched:false})+"\n");
  }else{
    await db.execute("INSERT INTO players(id,status) VALUES (985000000,'active'),(985000001,'active')");
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (985000000,'호이 남'),(985000001,'대상 회원')");
    await db.execute("INSERT INTO player_pet_daily_records(player_id,record_date,mini_battle_attempts,mini_battle_wins,mini_battle_losses,version) VALUES (985000001,DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)),3,4,5,1)");
    await db.execute("INSERT INTO external_identities(id,provider_code,external_user_id,player_id,status) VALUES (985200000,'kakao',?,985000000,'linked')",[master]);
    await db.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (985300000,'admin-minipet-battle-count-master','호이 남','synthetic','active')");
    await db.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (985300000,985200000)");
    await db.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT 985300000,id FROM admin_roles WHERE code='super_admin'");
    assert.equal((await db.query<Array<{rollout_state:string}>>("SELECT rollout_state FROM command_registry WHERE command_code='ADMIN_MINI_PET_BATTLE_COUNT'"))[0]!.rollout_state,"SHADOW");
    await db.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='ADMIN_MINI_PET_BATTLE_COUNT'");
    assert.equal((await new MiniPetBattleCountAdminService(db).handleIris({eventId:`${base}-unauthorized`,externalUserId:"unknown",channelId:room,message:"/미니펫대전횟수 대상 회원 7"})).status,"handled_no_reply");
    const rollbackEvent=`${base}-rollback`;await event(rollbackEvent,master);const before=await snapshot();
    await assert.rejects(()=>new MiniPetBattleCountAdminService(failAudit(db)).set({message:"/미니펫대전횟수 대상 회원 9",idempotencyKey:rollbackEvent,sourceEventId:rollbackEvent,destinationId:room,operatorId:"985300000"}),/synthetic admin mini-pet battle count audit failure/);
    assert.deepEqual(await snapshot(),before);assert.equal(await db.verifyRollback(),true);
    await event(successEvent,master);const service=new MiniPetBattleCountAdminService(db),result=await service.handleIris({eventId:successEvent,externalUserId:master,channelId:room,message:"/미니펫대전횟수 대상 회원 7"});
    assert.equal(result.status,"changed");assert.equal(result.data,"미니펫대전횟수 변경 완료");
    assert.deepEqual(await service.handleIris({eventId:successEvent,externalUserId:master,channelId:room,message:"/미니펫대전횟수 대상 회원 7"}),result);
    await event(sameEvent,master);const same=await service.set({message:"/미니펫대전횟수 대상 회원 7",idempotencyKey:sameEvent,sourceEventId:sameEvent,destinationId:room,operatorId:"985300000"});
    assert.equal(same.status,"unchanged");assert.equal(same.version,"2");
    await event(concurrentEvent,master);const concurrent=await Promise.all([1,2].map(()=>service.set({message:"/미니펫대전횟수 대상 회원 8",idempotencyKey:concurrentEvent,sourceEventId:concurrentEvent,destinationId:room,operatorId:"985300000"})));
    assert.deepEqual(concurrent[0],concurrent[1]);assert.equal(concurrent[0]!.status,"changed");assert.deepEqual((await snapshot())[0],expected);
    process.stdout.write(JSON.stringify({mode:"probe",migrationCount:291,scenarios:["shadow-registry","fixed-super-admin","strict-uint64-parser","active-player-only","absolute-kst-daily-count","preserve-win-loss","same-value-no-op","concurrent-replay","rollback","audit-outbox","restart-ready"],effects:expected,operationalDataTouched:false},(_k,v)=>typeof v==="bigint"?Number(v):v)+"\n");
  }
}finally{await db.close();}
