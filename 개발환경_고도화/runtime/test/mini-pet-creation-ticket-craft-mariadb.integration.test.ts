import assert from "node:assert/strict";
import { it } from "node:test";
import mariadb from "mariadb";
import type { DatabaseClient,DatabaseTransaction,DatabaseWriteResult } from "../src/database.js";
import { MiniPetCreationTicketCraftService } from "../src/mini-pet/creation-ticket-craft-service.js";
const enabled=process.env.HOIBOT_ISOLATED_MARIADB==="1";
it("crafts one stable creation mini-pet once and preserves it in the bag",{skip:!enabled},async()=>{
 const pool=mariadb.createPool({host:process.env.MARIADB_HOST!,port:Number(process.env.MARIADB_PORT),user:process.env.MARIADB_USER!,password:process.env.MARIADB_PASSWORD!,database:process.env.MARIADB_DATABASE!,connectionLimit:2,bigIntAsNumber:false});
 const database={async withTransaction<T>(work:(tx:DatabaseTransaction)=>Promise<T>):Promise<T>{const c=await pool.getConnection();try{await c.beginTransaction();
  const tx={query:async<R>(s:string,p?:unknown[])=>c.query(s,p)as Promise<R>,execute:async(s:string,p?:unknown[]):Promise<DatabaseWriteResult>=>{const r=await c.query(s,p)as{affectedRows?:number|bigint;insertId?:number|bigint};return{affectedRows:BigInt(r.affectedRows??0),insertId:BigInt(r.insertId??0)};}}as DatabaseTransaction;
  const result=await work(tx);await c.commit();return result;}catch(e){await c.rollback();throw e;}finally{c.release();}}}as DatabaseClient;
 try{const c=await pool.getConnection();try{
  await c.query("INSERT INTO players(id) VALUES(1)");await c.query("INSERT INTO player_profiles(player_id,current_display_name) VALUES(1,'창조회원')");
  await c.query("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,status) VALUES(81,1,'kakao','creation-user','linked')");
  await c.query("INSERT INTO event_inbox(event_id,event_kind,processing_status,received_at) VALUES('creation-event','message','processed',UTC_TIMESTAMP(3))");
  await c.query("INSERT INTO mini_pet_projection_environment_identity(singleton_id,environment_code,database_identity) VALUES(1,'dev','00000000-0000-0000-0000-000000000058')");
  await c.query("INSERT INTO mini_pet_inventory_player_states(player_id,bag_shape_code,capacity_limit) VALUES(1,'array',100)");
  const item=await c.query<Array<{id:bigint}>>("SELECT id FROM item_definitions WHERE code='bag_3241894752b82f7a'");
  await c.query("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES(1,?,25000,1)",[item[0]!.id]);
 }finally{c.release();}
 const service=new MiniPetCreationTicketCraftService(database);const input={externalUserId:"creation-user",channelId:"creation-room",eventId:"creation-event",message:"/미니펫창조조합",environmentCode:"dev"as const};
 const first=await service.execute(input),replay=await service.execute(input);assert.equal(first.status,"crafted");assert.equal(first.materialQuantity,"5000");assert.equal(first.afterSortIndex,1);assert.equal(replay.replayed,true);
 const v=await pool.getConnection();try{const rows=await v.query<Array<{display_name:string;grade_display_name:string;emoji_value:string;equipped:number;stable_owned_id:string;sort_index:number}>>(
  `SELECT definition.display_name,definition.grade_display_name,definition.emoji_value,owned.equipped,state.stable_owned_id,state.sort_index FROM owned_mini_pets owned JOIN mini_pet_definitions definition ON definition.id=owned.mini_pet_definition_id JOIN mini_pet_inventory_owned_states state ON state.owned_mini_pet_id=owned.id WHERE owned.player_id=1`);
  const material=await v.query<Array<{quantity:bigint}>>("SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=1 AND item.code='bag_3241894752b82f7a'");
  const counts=await v.query<Array<{events:bigint;operations:bigint;ledger:bigint;outbox:bigint}>>("SELECT (SELECT COUNT(*) FROM mini_pet_creation_ticket_craft_events) events,(SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'mini_pet.creation_ticket_craft:%') operations,(SELECT COUNT(*) FROM inventory_ledger WHERE reason_code='mini_pet_creation_ticket_craft') ledger,(SELECT COUNT(*) FROM outbox_messages) outbox");
  assert.equal(rows.length,1);assert.equal(rows[0]!.display_name,"컬렉션창조 미니펫");assert.equal(rows[0]!.grade_display_name,"창조");assert.equal(rows[0]!.emoji_value,"🐹");assert.equal(Boolean(rows[0]!.equipped),false);assert.equal(rows[0]!.sort_index,1);assert.ok(rows[0]!.stable_owned_id);
  assert.equal(Number(material[0]!.quantity),5000);assert.deepEqual([Number(counts[0]!.events),Number(counts[0]!.operations),Number(counts[0]!.ledger),Number(counts[0]!.outbox)],[1,1,1,1]);
 }finally{v.release();}
 }finally{await pool.end();}
});
