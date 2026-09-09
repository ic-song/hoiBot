import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { CastleBattleSelfRecordReadService } from "../src/castle/castle-battle-self-record-read-service.js";

const config=loadConfig();
if(!config.database.enabled||config.database.name!=="hoibot_castle_battle_self_record_g7") throw new Error(`Blocked database: ${config.database.name}`);
const database=createDatabaseClient(config.database);
const service=new CastleBattleSelfRecordReadService(database);
const base=process.env.CASTLE_RECORD_EVENT_ID??"castle-record-fixed";
const restart=process.argv.includes("--verify-restart");

async function event(id:string):Promise<void>{await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,'synthetic-castle-record-room','castle-record-user','message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",[id,id]);}
async function read(id:string){return service.handle({externalUserId:"castle-record-user",channelId:"synthetic-castle-record-room",message:"/캐슬전적",eventId:id});}
function failAudit(inner:DatabaseClient):DatabaseClient{return {ping:()=>inner.ping(),query:(sql,params)=>inner.query(sql,params),execute:(sql,params)=>inner.execute(sql,params),verifyRollback:()=>inner.verifyRollback(),close:async()=>undefined,withTransaction:<T>(work:(transaction:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction(transaction=>work({query:(sql,params)=>transaction.query(sql,params),execute:async(sql,params)=>{if(sql.includes("INSERT INTO command_audit"))throw new Error("synthetic castle record audit failure");return transaction.execute(sql,params);}}))};}
async function snapshot(){return (await database.query<Array<{operations:bigint;outboxes:bigint;audits:bigint;executions:bigint;states:bigint}>>(`SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'castle.battle.self-record.read:%') operations,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope LIKE 'castle.battle.self-record.read:%') outboxes,(SELECT COUNT(*) FROM command_audit WHERE action_code='castle-battle.self-record.read') audits,(SELECT COUNT(*) FROM command_executions WHERE command_code='castle_battle_self_record_read') executions,(SELECT COUNT(*) FROM castle_battle_player_states) states`))[0]!;}

try{
 if(restart){const before=await snapshot();const replay=await read(`${base}-read`);assert.equal(replay.replayed,true);assert.deepEqual(await snapshot(),before);process.stdout.write(`${JSON.stringify({mode:"verify-restart",operations:Number(before.operations),additionalMutation:false,operationalDataTouched:false})}\n`);}
 else{
  await database.execute("UPDATE castle_battle_seasons SET status='closed'");
  const season=await database.execute("INSERT INTO castle_battle_seasons(season_key,status,starts_at,version) VALUES ('synthetic-castle-record-g7','active',UTC_TIMESTAMP(3),1)");
  await database.execute("INSERT INTO players(id,status) VALUES (988700001,'active'),(988700002,'active')");
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name,level,experience) VALUES (988700001,'합성 전적회원',10,0),(988700002,'합성 경쟁회원',10,0)");
  await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (988700001,'kakao','castle-record-user','합성 전적회원','linked'),(988700002,'kakao','castle-record-rival','합성 경쟁회원','linked')");
  await database.execute("INSERT INTO pet_definitions(code,display_name,active) VALUES ('synthetic-record-pet','하늘',TRUE)");
  await database.execute("INSERT INTO player_pets(id,player_id,display_name,pet_type_code,image_value,experience,enhancement_level) VALUES (988710001,988700001,'전적펫','synthetic-record-pet','🐶',1200,12),(988710002,988700002,'경쟁펫','synthetic-record-pet','🐱',900,2)");
  await database.execute("INSERT INTO castle_battle_player_states(season_id,player_id,score,win_count,loss_count,tier_point,last_battle_at,version) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3)-INTERVAL 1 MINUTE,1),(?,?,?,?,?,?,UTC_TIMESTAMP(3),1)",[season.insertId,988700001,1234,3,1,12,season.insertId,988700002,1234,2,2,12]);
  const rollout=(await database.query<Array<{rollout_state:string}>>("SELECT rollout_state FROM command_registry WHERE command_code='CASTLE_BATTLE_SELF_RECORD_READ'"))[0]!;assert.equal(rollout.rollout_state,"SHADOW");
  await event(`${base}-read`);const first=await read(`${base}-read`);assert.equal(first.replayed,false);assert.match(first.data,/합성 전적회원/);assert.match(first.data,/순위: 2위/);assert.match(first.data,/승률 75\.00%/);assert.deepEqual(await read(`${base}-read`),{...first,replayed:true});
  await assert.rejects(()=>service.handle({externalUserId:"missing-user",channelId:"synthetic-castle-record-room",message:"/캐슬전적",eventId:`${base}-missing`}),/가입 후/);
  const expected={operations:1n,outboxes:1n,audits:1n,executions:1n,states:2n};assert.deepEqual(await snapshot(),expected);
  await event(`${base}-rollback`);const rollbackService=new CastleBattleSelfRecordReadService(failAudit(database));await assert.rejects(()=>rollbackService.handle({externalUserId:"castle-record-user",channelId:"synthetic-castle-record-room",message:"/캐슬전적",eventId:`${base}-rollback`}),/synthetic castle record audit failure/);assert.deepEqual(await snapshot(),expected);assert.equal(await database.verifyRollback(),true);
  process.stdout.write(`${JSON.stringify({mode:"probe",migrationCount:265,scenarios:["exact","self-record","stable-tie","missing","rollback","replay","restart-shadow"],effects:{operations:1,outboxes:1,audits:1,executions:1,states:2},operationalDataTouched:false})}\n`);
 }
}finally{await database.close();}
