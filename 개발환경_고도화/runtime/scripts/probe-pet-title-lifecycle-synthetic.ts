import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PetTitleLifecycleService } from "../src/pet/pet-title-lifecycle-service.js";

const config=loadConfig();
if(!config.database.enabled||!/^hoibot_pet_title_lifecycle(?:_[a-z0-9_]+)?$/i.test(config.database.name))throw new Error(`Blocked database: ${config.database.name}`);
const db=createDatabaseClient(config.database),service=new PetTitleLifecycleService(db);
const base=process.env.PET_TITLE_LIFECYCLE_EVENT_ID??"pet-title-lifecycle-g7-20260827-r1",room="synthetic-pet-title-room",restart=process.argv.includes("--verify-restart");
const input=(suffix:string,externalUserId:string,message:string)=>({eventId:`${base}-${suffix}`,externalUserId,destinationId:room,message});
async function event(suffix:string,externalUserId:string){const id=`${base}-${suffix}`;await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3))",[id,id,room,externalUserId]);}
function failAudit(inner:DatabaseClient):DatabaseClient{return{ping:()=>inner.ping(),query:(sql,p)=>inner.query(sql,p),execute:(sql,p)=>inner.execute(sql,p),verifyRollback:()=>inner.verifyRollback(),close:async()=>undefined,withTransaction:<T>(work:(tx:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction(tx=>work({query:(sql,p)=>tx.query(sql,p),execute:async(sql,p)=>{if(sql.includes("INSERT INTO command_audit"))throw new Error("synthetic pet title audit failure");return tx.execute(sql,p);}}))};}
async function snapshot(){return (await db.query<Array<{operations:bigint;outboxes:bigint;audits:bigint;executions:bigint;owned:bigint;removed:bigint;tickets:bigint;ledgers:bigint}>>(`SELECT
 (SELECT COUNT(*) FROM operations WHERE idempotency_key LIKE ?) operations,
 (SELECT COUNT(*) FROM outbox_messages m JOIN operations o ON o.id=m.operation_id WHERE o.idempotency_key LIKE ?) outboxes,
 (SELECT COUNT(*) FROM command_audit a JOIN operations o ON o.id=a.operation_id WHERE o.idempotency_key LIKE ?) audits,
 (SELECT COUNT(*) FROM command_executions WHERE event_id LIKE ?) executions,
 (SELECT COUNT(*) FROM player_pet_title_instances WHERE player_id=989700002 AND status='owned') owned,
 (SELECT COUNT(*) FROM player_pet_title_instances WHERE player_id=989700002 AND status='removed') removed,
 (SELECT quantity FROM inventory_stacks WHERE player_id=989700002 LIMIT 1) tickets,
 (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations o ON o.id=ledger.operation_id WHERE o.idempotency_key LIKE ?) ledgers`,[`${base}-%`,`${base}-%`,`${base}-%`,`${base}-%`,`${base}-%`]))[0]!;}
try{
 if(!restart){
  for(const [id,external,name,sourceOrder]of[[989700001,"pet-title-master","총괄 남",1],[989700002,"pet-title-user","대상 남",2]]as const){await db.execute("INSERT INTO players(id,status) VALUES (?,'active')",[id]);await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,?)",[id,name]);await db.execute("INSERT INTO external_identities(provider_code,external_user_id,player_id,status) VALUES ('kakao',?,?,'linked')",[external,id]);await db.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (?,'⭐',?)",[id,sourceOrder]);}
  await db.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (989730001,'pet-title-master','총괄 남','synthetic','active')");
  await db.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) SELECT 989730001,id FROM external_identities WHERE external_user_id='pet-title-master'");
  await db.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT 989730001,id FROM admin_roles WHERE code='super_admin'");
  const item=await db.execute("INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,active) VALUES ('synthetic-pet-title-ticket','펫타이틀권🦊(/펫타이틀이름)','legacy_bag_item',TRUE,TRUE)");
  await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (989700002,?,2,1)",[item.insertId]);
  for(const [suffix,external]of[["create","pet-title-user"],["select","pet-title-user"],["self","pet-title-user"],["target","pet-title-master"],["remove","pet-title-master"],["rollback","pet-title-user"]]as const)await event(suffix,external);
  assert.equal((await db.query<Array<{c:bigint}>>("SELECT COUNT(*) c FROM command_registry WHERE handler_key='pet_title_lifecycle' AND rollout_state='SHADOW'"))[0]!.c,5n);
  const created=await service.handle(input("create","pet-title-user","/펫타이틀이름 별빛 친구"));assert.equal(created.status,"created");
  assert.deepEqual(await service.handle(input("create","pet-title-user","/펫타이틀이름 별빛 친구")),created);
  const selected=await service.handle(input("select","pet-title-user","/펫타이틀 1"));assert.equal(selected.status,"selected");
  const self=await service.handle(input("self","pet-title-user","/펫타이틀목록"));assert.match(self.data!,/☞ 1\. 별빛 친구/);
  const target=await service.handle(input("target","pet-title-master","/펫타이틀목록 대상 남"));assert.match(target.data!,/가격: 🅟100,000,000/);
  const removed=await service.handle(input("remove","pet-title-master","/펫타이틀제거 대상 남 1"));assert.equal(removed.status,"removed");
  await assert.rejects(()=>new PetTitleLifecycleService(failAudit(db)).handle(input("rollback","pet-title-user","/펫타이틀이름 롤백 타이틀")),/synthetic pet title audit failure/);
  assert.deepEqual(await snapshot(),{operations:5n,outboxes:5n,audits:5n,executions:5n,owned:0n,removed:1n,tickets:1n,ledgers:1n});
  assert.equal(await db.verifyRollback(),true);
 }else{
  const before=await snapshot();await service.handle(input("create","pet-title-user","/펫타이틀이름 별빛 친구"));assert.deepEqual(await snapshot(),before);
  assert.deepEqual(before,{operations:5n,outboxes:5n,audits:5n,executions:5n,owned:0n,removed:1n,tickets:1n,ledgers:1n});
 }
 process.stdout.write(JSON.stringify({mode:restart?"verify-restart":"probe",migrationCount:172,scenarios:["shadow-registry","ticket-create","stable-instance","select","self-list","admin-detail-list","super-admin-remove","replay","rollback-check"],effects:await snapshot(),operationalDataTouched:false},(_k,v)=>typeof v==="bigint"?Number(v):v)+"\n");
}finally{await db.close();}
