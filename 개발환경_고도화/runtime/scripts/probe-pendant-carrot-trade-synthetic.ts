import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PendantCarrotTradeService } from "../src/market/pendant-carrot-trade-service.js";

const config=loadConfig();
if(!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if(!/^hoibot_pendant_carrot_trade(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic pendant carrot probe blocked: ${config.database.name}`);
const base=process.env.PENDANT_CARROT_TRADE_PROBE_EVENT_ID??"pendant-carrot-trade-g7-20260827-r1";
const restart=process.argv.includes("--verify-restart");
const db=createDatabaseClient(config.database); const room="synthetic-pendant-carrot-room"; const sender="pendant-carrot-sender";

// command execution 외래 키용 비식별 합성 event를 준비합니다.
async function event(id:string):Promise<void>{await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",[id,id,room,sender]);}

// 감사 직전 실패로 소유권·수수료·ledger 전체 rollback을 검증합니다.
function failAudit(inner:DatabaseClient):DatabaseClient{return{ping:()=>inner.ping(),query:(sql,params)=>inner.query(sql,params),execute:(sql,params)=>inner.execute(sql,params),verifyRollback:()=>inner.verifyRollback(),close:async()=>undefined,withTransaction:<T>(work:(transaction:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction(transaction=>work({query:(sql,params)=>transaction.query(sql,params),execute:async(sql,params)=>{if(sql.includes("INSERT INTO command_audit"))throw new Error("synthetic pendant carrot audit failure");return transaction.execute(sql,params);}}))};}

async function snapshot():Promise<Array<{ownerId:bigint;instanceVersion:bigint;carrots:bigint;carrotVersion:bigint;operations:bigint;outboxes:bigint;trades:bigint;audits:bigint;ledgers:bigint}>>{return db.query(`SELECT
 (SELECT player_id FROM inventory_instances WHERE id=987100001) ownerId,(SELECT version FROM inventory_instances WHERE id=987100001) instanceVersion,
 (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=987000000 AND item.code='ITEM-RWD-044') carrots,
 (SELECT stack.version FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=987000000 AND item.code='ITEM-RWD-044') carrotVersion,
 (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pendant.carrot.trade') operations,
 (SELECT COUNT(*) FROM outbox_messages o JOIN operations p ON p.id=o.operation_id WHERE p.idempotency_scope='pendant.carrot.trade') outboxes,
 (SELECT COUNT(*) FROM pendant_carrot_trades) trades,(SELECT COUNT(*) FROM command_audit WHERE action_code LIKE 'pendant.carrot.trade%') audits,
 (SELECT COUNT(*) FROM inventory_ledger WHERE reason_code='PENDANT_CARROT_TRADE_FEE') ledgers`);}

try{
 const successEvent=`${base}-success`;
 if(restart){const before=await snapshot();const result=await new PendantCarrotTradeService(db).handle({eventId:successEvent,externalUserId:sender,destinationId:room,message:"/펜던트당근거래 대상 남 1"});assert.equal(result.status,"traded");assert.deepEqual(await snapshot(),before);assert.deepEqual(before[0],{ownerId:987000001n,instanceVersion:2n,carrots:150n,carrotVersion:2n,operations:4n,outboxes:4n,trades:1n,audits:4n,ledgers:1n});process.stdout.write(JSON.stringify({mode:"verify-restart",operations:4,trades:1,additionalMutation:false,operationalDataTouched:false})+"\n");}
 else{
  await db.execute("INSERT INTO players(id,status) VALUES (987000000,'active'),(987000001,'active'),(987000002,'active'),(987000003,'active')");
  await db.execute("INSERT INTO player_profiles(player_id,current_display_name,tier_code) VALUES (987000000,'보낸 남','king'),(987000001,'대상 남','king'),(987000002,'낮은 남','common'),(987000003,'가득 남','king')");
  await db.execute("INSERT INTO player_pets(id,player_id,display_name) VALUES (987000000,987000000,'보낸 펫'),(987000001,987000001,'대상 펫'),(987000002,987000002,'낮은 펫'),(987000003,987000003,'가득 펫')");
  await db.execute("INSERT INTO external_identities(id,provider_code,external_user_id,player_id,status) VALUES (987200000,'kakao',?,987000000,'linked')",[sender]);
  const carrotRows=await db.query<Array<{id:bigint}>>("SELECT id FROM item_definitions WHERE code='ITEM-RWD-044' LIMIT 1");
  let carrotId=carrotRows[0]?.id;
  if(carrotId===undefined){await db.execute("INSERT INTO item_definitions(id,code,display_name,asset_type_code,stackable,active,version) VALUES (987400000,'ITEM-RWD-044','당근','ITEM',1,1,1)");carrotId=987400000n;}
  await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (987000000,?,250,1)",[carrotId]);
  await db.execute("INSERT INTO item_definitions(id,code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES (987400001,'PENDANT-CARROT-ONE','합성거래펜던트','ITEM',0,JSON_OBJECT('objectType','pendant'),1,1)");
  await db.execute("INSERT INTO inventory_instances(id,player_id,item_id,status,attributes_json,version) VALUES (987100001,987000000,987400001,'owned',JSON_OBJECT('objectType','pendant','name','합성거래펜던트','icon','💎','grade','하급','durability',5,'maxDurability',5,'upgrade',2),1),(987100002,987000000,987400001,'owned',JSON_OBJECT('objectType','pendant','name','합성잔여펜던트','icon','🔷','grade','하급','durability',4,'maxDurability',5,'upgrade',1),1)");
  for(let i=0;i<50;i++)await db.execute("INSERT INTO inventory_instances(id,player_id,item_id,status,attributes_json,version) VALUES (?,987000003,987400001,'owned',JSON_OBJECT('objectType','pendant','name',CONCAT('가득',?),'grade','하급','durability',5,'maxDurability',5,'upgrade',0),1)",[987110000+i,String(i)]);
  assert.equal((await db.query<Array<{rollout_state:string}>>("SELECT rollout_state FROM command_registry WHERE command_code='PENDANT_CARROT_TRADE'"))[0]!.rollout_state,"SHADOW");
  const service=new PendantCarrotTradeService(db);
  await event(successEvent);const success=await service.handle({eventId:successEvent,externalUserId:sender,destinationId:room,message:"/펜던트당근거래 대상 남 1"});assert.equal(success.status,"traded");assert.equal(success.instanceId,"987100001");assert.match(success.data!,/수수료: 당근🥕 100개/);assert.deepEqual(await service.handle({eventId:successEvent,externalUserId:sender,destinationId:room,message:"/펜던트당근 대상 남 1"}),success);
  const usageEvent=`${base}-usage`;await event(usageEvent);assert.equal((await service.handle({eventId:usageEvent,externalUserId:sender,destinationId:room,message:"/펜던트당근"})).status,"usage");
  const lowEvent=`${base}-low`;await event(lowEvent);assert.equal((await service.handle({eventId:lowEvent,externalUserId:sender,destinationId:room,message:"/펜던트당근 낮은 남 1"})).status,"rejected");
  const fullEvent=`${base}-full`;await event(fullEvent);assert.equal((await service.handle({eventId:fullEvent,externalUserId:sender,destinationId:room,message:"/펜던트당근 가득 남 1"})).status,"rejected");
  const rollbackEvent=`${base}-rollback`;await event(rollbackEvent);const beforeRollback=await snapshot();await assert.rejects(()=>new PendantCarrotTradeService(failAudit(db)).handle({eventId:rollbackEvent,externalUserId:sender,destinationId:room,message:"/펜던트당근 대상 남 1"}),/synthetic pendant carrot audit failure/);assert.deepEqual(await snapshot(),beforeRollback);assert.equal(await db.verifyRollback(),true);
  const effects=await snapshot();assert.deepEqual(effects[0],{ownerId:987000001n,instanceVersion:2n,carrots:150n,carrotVersion:2n,operations:4n,outboxes:4n,trades:1n,audits:4n,ledgers:1n});
  process.stdout.write(JSON.stringify({mode:"probe",migrationCount:124,scenarios:["shadow-registry","alias-transfer","stable-index","tier","capacity","fee","replay","usage","rollback"],effects:effects[0],operationalDataTouched:false},(_k,v)=>typeof v==="bigint"?Number(v):v)+"\n");
 }
}finally{await db.close();}
