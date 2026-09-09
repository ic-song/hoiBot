import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PetSkillExtinctionService,PET_SKILL_EXTINCTION_TICKET_CODE } from "../src/pet/pet-skill-extinction-service.js";
const config=loadConfig();
if(!config.database.enabled)throw new Error("DATABASE_ENABLED must be true.");
if(!/^hoibot_pet_skill_extinction(?:_[a-z0-9_]+)?$/i.test(config.database.name))throw new Error(`blocked ${config.database.name}`);
const db=createDatabaseClient(config.database),service=new PetSkillExtinctionService(db),base="pet-skill-extinction-g7-r1";
async function event(id:string){await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,'ext-room','ext-user','message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status='processed'",[id,id]);}
function failAudit(inner:DatabaseClient):DatabaseClient{return{ping:()=>inner.ping(),query:(s,p)=>inner.query(s,p),execute:(s,p)=>inner.execute(s,p),verifyRollback:()=>inner.verifyRollback(),close:async()=>undefined,withTransaction:<T>(work:(transaction:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction(transaction=>work({query:(s,p)=>transaction.query(s,p),execute:async(s,p)=>{if(s.includes("INSERT INTO command_audit"))throw new Error("synthetic extinction audit failure");return transaction.execute(s,p);}}))};}
try{
  if(process.argv.includes("--verify-restart")){
    const before=await db.query<Array<{skills:bigint;quantity:bigint;operations:bigint}>>("SELECT (SELECT COUNT(*) FROM pet_skills WHERE player_pet_id=988000001) skills,(SELECT quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=988000001 AND item.code=?) quantity,(SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.skill_extinction' AND idempotency_key=?) operations",[PET_SKILL_EXTINCTION_TICKET_CODE,base+"-success"]);
    await service.handle({eventId:base+"-success",externalUserId:"ext-user",destinationId:"ext-room",message:"/펫스킬소멸 1"});
    const after=await db.query<typeof before>("SELECT (SELECT COUNT(*) FROM pet_skills WHERE player_pet_id=988000001) skills,(SELECT quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=988000001 AND item.code=?) quantity,(SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.skill_extinction' AND idempotency_key=?) operations",[PET_SKILL_EXTINCTION_TICKET_CODE,base+"-success"]);
    assert.deepEqual(after,before);process.stdout.write(JSON.stringify({mode:"verify-restart",skills:"1",quantity:"1",operations:"1",additionalMutation:false})+"\n");process.exit(0);
  }
  await db.execute("INSERT INTO players(id,status) VALUES(988000001,'active')");
  await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES(988000001,'소멸테스터')");
  await db.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES(988000001,988000001,'kakao','ext-user','소멸테스터','linked')");
  await db.execute("INSERT INTO player_pets(id,player_id,display_name,image_value,experience) VALUES(988000001,988000001,'소멸펫','🐶',0)");
  await db.execute("INSERT INTO skill_definitions(id,code,display_name,rules_json,active) VALUES(988000001,'ext-a','십원',JSON_OBJECT(),TRUE),(988000002,'ext-b','구원',JSON_OBJECT(),TRUE)");
  await db.execute("INSERT INTO pet_skills(player_pet_id,slot_no,skill_id,level,equipped) VALUES(988000001,1,988000001,1,TRUE),(988000001,2,988000002,1,TRUE)");
  const item=(await db.query<Array<{id:bigint}>>("SELECT id FROM item_definitions WHERE code=?",[PET_SKILL_EXTINCTION_TICKET_CODE]))[0]!;
  await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity) VALUES(988000001,?,2)",[item.id]);
  const rollback=base+"-rollback";await event(rollback);
  await assert.rejects(()=>new PetSkillExtinctionService(failAudit(db)).handle({eventId:rollback,externalUserId:"ext-user",destinationId:"ext-room",message:"/펫스킬소멸 1"}),/synthetic extinction audit failure/);
  assert.deepEqual((await db.query<Array<{skills:bigint;quantity:bigint;operations:bigint}>>("SELECT (SELECT COUNT(*) FROM pet_skills WHERE player_pet_id=988000001) skills,(SELECT quantity FROM inventory_stacks WHERE player_id=988000001 AND item_id=?) quantity,(SELECT COUNT(*) FROM operations WHERE idempotency_key=?) operations",[item.id,rollback]))[0],{skills:2n,quantity:2n,operations:0n});
  const success=base+"-success";await event(success);
  const result=await service.handle({eventId:success,externalUserId:"ext-user",destinationId:"ext-room",message:"/펫스킬소멸 1"});
  assert.equal(result.reply,"✅ 십원📙 소멸 완료!");assert.equal(result.mutated,true);
  assert.deepEqual(await service.handle({eventId:success,externalUserId:"ext-user",destinationId:"ext-room",message:"/펫스킬소멸 1"}),result);
  const state=await db.query<Array<{skills:bigint;slot_no:number;quantity:bigint;ledger:bigint}>>("SELECT (SELECT COUNT(*) FROM pet_skills WHERE player_pet_id=988000001) skills,(SELECT slot_no FROM pet_skills WHERE player_pet_id=988000001) slot_no,(SELECT quantity FROM inventory_stacks WHERE player_id=988000001 AND item_id=?) quantity,(SELECT COUNT(*) FROM inventory_ledger WHERE reason_code='pet_skill_extinction') ledger",[item.id]);
  assert.deepEqual(state[0],{skills:1n,slot_no:1,quantity:1n,ledger:1n});
  const invalid=base+"-invalid";await event(invalid);
  assert.equal((await service.handle({eventId:invalid,externalUserId:"ext-user",destinationId:"ext-room",message:"/펫스킬소멸 1 해봐"})).mutated,false);
  process.stdout.write(JSON.stringify({scenarios:["atomic-remove","slot-reorder","ticket-ledger","replay","invalid-suffix","forced-rollback"],state:state[0]},(_key,value)=>typeof value==="bigint"?value.toString():value)+"\n");
}finally{await db.close();}
