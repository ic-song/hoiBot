import assert from "node:assert/strict";
import { it } from "node:test";
import mariadb from "mariadb";
import type { DatabaseClient,DatabaseTransaction,DatabaseWriteResult } from "../src/database.js";
import { MiniPetBulkSaleService } from "../src/mini-pet/bulk-sale-service.js";

const enabled=process.env.HOIBOT_ISOLATED_MARIADB==="1";
it("sells only the stable range once and preserves remaining bag order",{skip:!enabled},async()=>{
 const pool=mariadb.createPool({host:process.env.MARIADB_HOST!,port:Number(process.env.MARIADB_PORT),user:process.env.MARIADB_USER!,
  password:process.env.MARIADB_PASSWORD!,database:process.env.MARIADB_DATABASE!,connectionLimit:2,bigIntAsNumber:false});
 const database={async withTransaction<T>(work:(tx:DatabaseTransaction)=>Promise<T>):Promise<T>{const c=await pool.getConnection();
  try{await c.beginTransaction();const tx={query:async<R>(sql:string,p?:unknown[])=>c.query(sql,p)as Promise<R>,
   execute:async(sql:string,p?:unknown[]):Promise<DatabaseWriteResult>=>{const r=await c.query(sql,p)as{affectedRows?:number|bigint;insertId?:number|bigint};
    return{affectedRows:BigInt(r.affectedRows??0),insertId:BigInt(r.insertId??0)};}}as DatabaseTransaction;
   const result=await work(tx);await c.commit();return result;}catch(error){await c.rollback();throw error;}finally{c.release();}}}as DatabaseClient;
 try{const c=await pool.getConnection();try{
  await c.query("INSERT INTO players(id) VALUES(1)");
  await c.query("INSERT INTO player_profiles(player_id,current_display_name) VALUES(1,'일괄판매자')");
  await c.query("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,status) VALUES(1,1,'kakao','bulk-user','linked')");
  await c.query("INSERT INTO event_inbox(event_id,event_kind,processing_status,received_at) VALUES('bulk-event','message','processed',UTC_TIMESTAMP(3))");
  await c.query("INSERT INTO mini_pet_projection_environment_identity(singleton_id,environment_code,database_identity) VALUES(1,'dev','00000000-0000-0000-0000-000000000056')");
  await c.query("INSERT INTO mini_pet_definitions(id,code,display_name) VALUES(900061,'bulk-1','첫째'),(900062,'bulk-2','둘째'),(900063,'bulk-3','셋째'),(900064,'bulk-4','넷째')");
  await c.query("INSERT INTO owned_mini_pets(id,player_id,mini_pet_definition_id,custom_name,equipped) VALUES(700061,1,900061,'첫째',FALSE),(700062,1,900062,'둘째',FALSE),(700063,1,900063,'셋째',FALSE),(700064,1,900064,'넷째',FALSE)");
  await c.query(`INSERT INTO mini_pet_inventory_owned_states(owned_mini_pet_id,player_id,stable_owned_id,sort_index) VALUES
   (700061,1,'00000000-0000-0000-0000-000000700061',1),(700062,1,'00000000-0000-0000-0000-000000700062',2),
   (700063,1,'00000000-0000-0000-0000-000000700063',3),(700064,1,'00000000-0000-0000-0000-000000700064',4)`);
  await c.query("INSERT INTO mini_pet_sale_policies(mini_pet_definition_id,point_price,sellable) VALUES(900062,5000,TRUE),(900063,7000,TRUE)");
  await c.query("INSERT INTO currency_definitions(code,display_name,scale_digits) VALUES('point','포인트',0) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name)");
  await c.query("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES(1,'point',1000,1)");
 }finally{c.release();}
 const service=new MiniPetBulkSaleService(database);const command={externalUserId:"bulk-user",channelId:"bulk-room",eventId:"bulk-event",message:"/미니펫지정판매 2 3",environmentCode:"dev"as const};
 const first=await service.execute(command),replay=await service.execute(command);
 assert.equal(first.status,"sold");assert.equal(first.soldCount,2);assert.equal(first.pointDelta,"12000");assert.equal(first.pointBalance,"13000");assert.equal(replay.replayed,true);
 const v=await pool.getConnection();try{
  const lifecycle=await v.query<Array<{owned_mini_pet_id:bigint;state_code:string}>>("SELECT owned_mini_pet_id,state_code FROM mini_pet_owned_lifecycle ORDER BY owned_mini_pet_id");
  const header=await v.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM mini_pet_bulk_sale_events");
  const entries=await v.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM mini_pet_bulk_sale_entries");
  const ledger=await v.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM currency_ledger WHERE reason_code='mini_pet_bulk_sale'");
  const account=await v.query<Array<{balance:string}>>("SELECT balance FROM currency_accounts WHERE player_id=1 AND currency_code='point'");
  const states=await v.query<Array<{owned_mini_pet_id:bigint;sort_index:number|null}>>("SELECT owned_mini_pet_id,sort_index FROM mini_pet_inventory_owned_states ORDER BY owned_mini_pet_id");
  assert.deepEqual(lifecycle.map(r=>[Number(r.owned_mini_pet_id),r.state_code]),[[700062,"sold"],[700063,"sold"]]);
  assert.equal(Number(header[0]!.count_value),1);assert.equal(Number(entries[0]!.count_value),2);assert.equal(Number(ledger[0]!.count_value),1);assert.equal(String(account[0]!.balance),"13000.000");
  assert.deepEqual(states.map(r=>[Number(r.owned_mini_pet_id),r.sort_index]),[[700061,1],[700062,null],[700063,null],[700064,2]]);
 }finally{v.release();}
 }finally{await pool.end();}
});
