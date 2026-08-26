import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PendantMarketRegisterService } from "../src/market/pendant-market-register-service.js";

const config=loadConfig();
if(!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if(!/^hoibot_pendant_market_register(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic pendant market probe blocked: ${config.database.name}`);
const db=createDatabaseClient(config.database); const user="pendant-market-user"; const room="synthetic-pendant-market-room"; const base=process.env.PENDANT_MARKET_REGISTER_PROBE_EVENT_ID??"pendant-market-register-g7-20260827-r1";
let carrotItemId=0n;

async function event(id:string):Promise<void>{await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3))",[id,id,room,user]);}
function failAudit(inner:DatabaseClient):DatabaseClient{return{ping:()=>inner.ping(),query:(sql,params)=>inner.query(sql,params),execute:(sql,params)=>inner.execute(sql,params),verifyRollback:()=>inner.verifyRollback(),close:async()=>undefined,withTransaction:<T>(work:(transaction:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction((transaction)=>work({query:(sql,params)=>transaction.query(sql,params),execute:async(sql,params)=>{if(sql.includes("INSERT INTO command_audit"))throw new Error("synthetic pendant market audit failure");return transaction.execute(sql,params);}}))};}
async function snapshot(){return db.query<Array<{status:string;version:bigint;carrots:bigint;listings:bigint;confirmations:bigint;ledgers:bigint}>>(`SELECT
 (SELECT status FROM inventory_instances WHERE id=990100001) status,(SELECT version FROM inventory_instances WHERE id=990100001) version,
 (SELECT quantity FROM inventory_stacks WHERE player_id=990000001 AND item_id=?) carrots,
 (SELECT COUNT(*) FROM market_listings WHERE seller_player_id=990000001) listings,(SELECT COUNT(*) FROM market_registration_confirmations WHERE player_id=990000001) confirmations,
 (SELECT COUNT(*) FROM market_pendant_registration_ledger WHERE player_id=990000001) ledgers`,[carrotItemId]);}

try{
 await db.execute("INSERT INTO players(id,status) VALUES (990000001,'active')");
 await db.execute("INSERT INTO player_profiles(player_id,current_display_name,tier_code) VALUES (990000001,'시장 남','king')");
 await db.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (990000001,'👑',990000001)");
 await db.execute("INSERT INTO external_identities(id,provider_code,external_user_id,player_id,status) VALUES (990200001,'kakao',?,990000001,'linked')",[user]);
 await db.execute("INSERT INTO player_pets(id,player_id,display_name) VALUES (990300001,990000001,'시장 펫')");
 await db.execute("INSERT INTO item_definitions(id,code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES (990400001,'PENDANT-MARKET-SYNTHETIC','합성시장펜던트','ITEM',0,JSON_OBJECT('objectType','pendant'),1,1)");
 carrotItemId=(await db.query<Array<{id:bigint}>>("SELECT id FROM item_definitions WHERE code='ITEM-RWD-044'"))[0]!.id;
 await db.execute("INSERT INTO inventory_instances(id,player_id,item_id,status,attributes_json,version) VALUES (990100001,990000001,990400001,'owned',JSON_OBJECT('objectType','pendant','name','합성시장펜던트','icon','💎','grade','하급','durability',5,'maxDurability',5,'upgrade',3),1)");
 await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (990000001,?,150,1)",[carrotItemId]);
 assert.equal((await db.query<Array<{rollout_state:string}>>("SELECT rollout_state FROM command_registry WHERE command_code='PENDANT_MARKET_REGISTER'"))[0]!.rollout_state,"SHADOW");
 const service=new PendantMarketRegisterService(db); const first=`${base}-first`; await event(first);
 const pending=await service.handle({eventId:first,externalUserId:user,destinationId:room,message:"/펜던트거래등록 1 5000000"}); assert.equal(pending.status,"pending");
 assert.deepEqual((await snapshot())[0],{status:"owned",version:1n,carrots:150n,listings:0n,confirmations:1n,ledgers:0n});
 assert.deepEqual(await service.handle({eventId:first,externalUserId:user,destinationId:room,message:"/펜던트거래등록 1 5000000"}),pending);
 const second=`${base}-second`; await event(second); const registered=await service.handle({eventId:second,externalUserId:user,destinationId:room,message:"/펜던트거래등록 1 5000000"}); assert.equal(registered.status,"registered");
 assert.deepEqual((await snapshot())[0],{status:"reserved",version:2n,carrots:50n,listings:1n,confirmations:0n,ledgers:1n});
 await db.execute("INSERT INTO inventory_instances(id,player_id,item_id,status,attributes_json,version) VALUES (990100002,990000001,990400001,'owned',JSON_OBJECT('objectType','pendant','name','롤백펜던트','icon','🔷','grade','최하급','durability',5,'maxDurability',5,'upgrade',0),1)");
 await db.execute("UPDATE inventory_stacks SET quantity=150,version=version+1 WHERE player_id=990000001 AND item_id=?",[carrotItemId]);
 const third=`${base}-rollback-confirm`; await event(third); await service.handle({eventId:third,externalUserId:user,destinationId:room,message:"/펜던트거래등록 1 7000000"});
 const fourth=`${base}-rollback`; await event(fourth); const before=await snapshot(); await assert.rejects(()=>new PendantMarketRegisterService(failAudit(db)).handle({eventId:fourth,externalUserId:user,destinationId:room,message:"/펜던트거래등록 1 7000000"}),/synthetic pendant market audit failure/); assert.deepEqual(await snapshot(),before); assert.equal(await db.verifyRollback(),true);
 process.stdout.write(JSON.stringify({mode:"probe",migrationCount:121,scenarios:["shadow-registry","tier-policy","stable-index","confirmation","replay","atomic-register","rollback"],operationalDataTouched:false})+"\n");
}finally{await db.close();}
