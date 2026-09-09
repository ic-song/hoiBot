import assert from "node:assert/strict";
import { createDatabaseClient,type DatabaseClient,type DatabaseTransaction } from "../src/database.js";
import { loadConfig } from "../src/config.js";
import { MiniPetBagThresholdCleanService } from "../src/mini-pet/mini-pet-bag-threshold-clean-service.js";

const config=loadConfig();
if(!config.database.enabled||!/^hoibot_minipet_bag_threshold_clean(?:_[a-z0-9_]+)?$/i.test(config.database.name))throw new Error("Mini pet bag threshold clean probe requires an isolated database.");
const database=createDatabaseClient(config.database),base="synthetic-minipet-bag-clean",actor="minipet-bag-clean-actor";
async function event(id:string){await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES(?,?,?,?,'message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3))",[id,id,"synthetic-minipet-bag-clean-room",actor]);}
function failAudit(inner:DatabaseClient):DatabaseClient{return{ping:()=>inner.ping(),query:(s,p)=>inner.query(s,p),execute:(s,p)=>inner.execute(s,p),verifyRollback:()=>inner.verifyRollback(),close:async()=>undefined,withTransaction:<T>(work:(t:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction(t=>work({query:(s,p)=>t.query(s,p),execute:async(s,p)=>{if(s.includes("INSERT INTO command_audit"))throw new Error("synthetic minipet bag clean audit failure");return t.execute(s,p);}}))};}
async function snapshot(){return database.query<Array<{pets:bigint;runs:bigint;cleanup_lines:bigint;operations:bigint;audits:bigint;executions:bigint;outboxes:bigint;ledgers:bigint;balance:string;guild_version:bigint}>>(`SELECT
 (SELECT COUNT(*) FROM owned_mini_pets WHERE player_id=994000001) pets,
 (SELECT COUNT(*) FROM mini_pet_bag_cleanup_runs WHERE player_id=994000001) runs,
 (SELECT COUNT(*) FROM mini_pet_bag_cleanup_lines) cleanup_lines,
 (SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'mini-pet.bag.threshold-clean:%') operations,
 (SELECT COUNT(*) FROM command_audit WHERE action_code='mini_pet.bag.threshold_clean') audits,
 (SELECT COUNT(*) FROM command_executions WHERE command_code='MINI_PET_BAG_THRESHOLD_CLEAN') executions,
 (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope LIKE 'mini-pet.bag.threshold-clean:%') outboxes,
 (SELECT COUNT(*) FROM currency_ledger WHERE reason_code='mini_pet_bag_threshold_clean') ledgers,
 (SELECT CAST(balance AS CHAR) FROM currency_accounts WHERE player_id=994000001 AND currency_code='point') balance,
 (SELECT version FROM guilds WHERE id=994400001) guild_version`);}
async function seed(){
  await database.execute("INSERT INTO players(id,status,version) VALUES(994000001,'active',1)");
  await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES(994200001,994000001,'kakao',?,'합성회원','linked')",[actor]);
  await database.execute("INSERT INTO mini_pet_definitions(id,code,display_name,grade_code,grade_display_name,emoji_value,active) VALUES(994100001,'SYNTH-MINI-NORMAL','일반 미니펫','normal','일반','🐹',1),(994100002,'SYNTH-MINI-PRIMORDIAL','태초 미니펫','primordial','태초','🐹',1)");
  await database.execute("INSERT INTO owned_mini_pets(id,player_id,mini_pet_definition_id,battle_experience,equipped,sale_price,is_elite,bag_sequence,version) VALUES(994300001,994000001,994100001,10,0,500,0,1,1),(994300002,994000001,994100002,0,0,600,0,2,1),(994300003,994000001,994100001,0,0,700,1,3,1),(994300004,994000001,994100001,101,0,800,0,4,1),(994300005,994000001,994100001,20,0,NULL,0,5,1),(994300006,994000001,994100001,30,0,-50,0,6,1),(994300007,994000001,994100001,0,1,900,0,7,1)");
  await database.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES(994000001,'point',1000,1)");
  await database.execute("INSERT INTO guilds(id,code,display_name,status,version) VALUES(994400001,'SYNTH-MINIPET-CLEAN','보존 길드','active',7)");
}
async function probe(){
  await seed();assert.equal((await database.query<Array<{rollout_state:string}>>("SELECT rollout_state FROM command_registry WHERE command_code='MINI_PET_BAG_THRESHOLD_CLEAN'"))[0]?.rollout_state,"SHADOW");
  const service=new MiniPetBagThresholdCleanService(database),success=`${base}-success`;await event(success);const first=await service.handle({eventId:success,externalUserId:actor,message:"/미니펫가방정리 30"});
  assert.equal(first.removedCount,3);assert.equal(first.pointDelta,"100450");assert.equal(first.balanceAfter,"101450");assert.deepEqual(await service.handle({eventId:success,externalUserId:actor,message:"/미니펫가방정리 30"}),{...first,replayed:true});
  let state=(await snapshot())[0]!;assert.deepEqual(state,{pets:4n,runs:1n,cleanup_lines:3n,operations:1n,audits:1n,executions:1n,outboxes:1n,ledgers:1n,balance:"101450.000",guild_version:7n});
  await database.execute("INSERT INTO owned_mini_pets(id,player_id,mini_pet_definition_id,battle_experience,equipped,sale_price,is_elite,bag_sequence,version) VALUES(994300008,994000001,994100001,5,0,1000,0,8,1)");
  const concurrent=`${base}-concurrent`;await event(concurrent);const pair=await Promise.all([service.handle({eventId:concurrent,externalUserId:actor,message:"/미니펫가방정리 5"}),service.handle({eventId:concurrent,externalUserId:actor,message:"/미니펫가방정리 5"})]);assert.equal(pair[0]?.outboxId,pair[1]?.outboxId);assert.deepEqual(pair.map(value=>value.replayed).sort(),[false,true]);
  await database.execute("INSERT INTO owned_mini_pets(id,player_id,mini_pet_definition_id,battle_experience,equipped,sale_price,is_elite,bag_sequence,version) VALUES(994300009,994000001,994100001,1,0,2000,0,9,1)");
  const rollback=`${base}-rollback`;await event(rollback);const before=await snapshot();await assert.rejects(()=>new MiniPetBagThresholdCleanService(failAudit(database)).handle({eventId:rollback,externalUserId:actor,message:"/미니펫가방정리 1"}),/synthetic minipet bag clean audit failure/);assert.deepEqual(await snapshot(),before);assert.equal(await database.verifyRollback(),true);
  state=(await snapshot())[0]!;assert.deepEqual(state,{pets:5n,runs:2n,cleanup_lines:4n,operations:2n,audits:2n,executions:2n,outboxes:2n,ledgers:2n,balance:"102450.000",guild_version:7n});
  process.stdout.write(JSON.stringify({mode:"probe",migrationCount:280,scenarios:["shadow","strict-boundary","protected","fallback-price","stable-id","replay","concurrent","rollback","other-domain-preserved"],effects:{operations:2,runs:2,lines:4,audits:2,executions:2,outboxes:2,ledgers:2,balance:"102450.000"},domainMutation:{miniPetBag:true,currency:true,otherDomains:false}})+"\n");
}
async function restart(){const before=await snapshot(),result=await new MiniPetBagThresholdCleanService(database).handle({eventId:`${base}-success`,externalUserId:actor,message:"/미니펫가방정리 30"});assert.equal(result.replayed,true);assert.deepEqual(await snapshot(),before);process.stdout.write(JSON.stringify({mode:"verify-restart",replayStable:true,additionalMutation:false,otherDomainsMutated:false})+"\n");}
try{if(process.argv.includes("--verify-restart"))await restart();else await probe();}finally{await database.close();}
