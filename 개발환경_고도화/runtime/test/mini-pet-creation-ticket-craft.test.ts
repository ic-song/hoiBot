import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { isMiniPetCreationTicketCraftCommand, MiniPetCreationTicketCraftService } from "../src/mini-pet/creation-ticket-craft-service.js";

function scripted(results: unknown[]) { const queue=[...results],sql:string[]=[];let insertId=80n;
 const tx:DatabaseTransaction={query:async<T>(s:string):Promise<T>=>{sql.push(s);return(queue.shift()??[])as T;},
 execute:async(s:string):Promise<DatabaseWriteResult>=>{sql.push(s);insertId++;return{affectedRows:1n,insertId};}};
 return{sql,database:{ping:async()=>undefined,verifyRollback:async()=>true,query:tx.query,execute:tx.execute,
 withTransaction:async<T>(work:(v:DatabaseTransaction)=>Promise<T>)=>work(tx),close:async()=>undefined}as DatabaseClient};}
const command={externalUserId:"creator",channelId:"room",eventId:"creation-event",message:"/미니펫창조조합",environmentCode:"dev"as const};

describe("mini-pet creation ticket craft",()=>{
 it("accepts only the exact command",async()=>{assert.equal(isMiniPetCreationTicketCraftCommand(command.message),true);assert.equal(isMiniPetCreationTicketCraftCommand("/미니펫창조조합 1"),false);
  await assert.rejects(()=>new MiniPetCreationTicketCraftService(scripted([]).database).execute({...command,message:"/미니펫창조조합 1"}),
   (error:unknown)=>error instanceof ApplicationError&&error.statusCode===422);});
 it("consumes 20000 tickets and grants one stable creation pet atomically",async()=>{
  const s=scripted([[{environment_code:"dev"}],[{active_count:0n}],[{identity_id:1n,player_id:2n,current_display_name:"회원"}],[],
   [{capacity_limit:100,bag_shape_code:"array"}],[{owned_mini_pet_id:70n,sort_index:1}],[{item_id:3n,quantity:25000n,version:1n}],[{id:4n,display_name:"컬렉션창조 미니펫"}]]);
  const result=await new MiniPetCreationTicketCraftService(s.database).execute(command);
  assert.equal(result.status,"crafted");assert.equal(result.materialQuantity,"5000");assert.equal(result.afterSortIndex,2);assert.ok(result.stableOwnedId);
  for(const x of ["UPDATE inventory_stacks","INSERT INTO owned_mini_pets","mini_pet_inventory_owned_states","mini_pet_creation_ticket_craft_events","inventory_ledger","outbox_messages"]) assert.equal(s.sql.some(q=>q.includes(x)),true);
 });
 it("keeps the castle siege block silent before member and inventory access",async()=>{const s=scripted([[{environment_code:"dev"}],[{active_count:1n}]]);
  assert.deepEqual(await new MiniPetCreationTicketCraftService(s.database).execute(command),{status:"blocked_by_castle_siege"});assert.equal(s.sql.length,2);});
 it("replays the prior event without another material or pet mutation",async()=>{const prior={status:"crafted"as const,materialQuantity:"5000",stableOwnedId:"stable"};
  const s=scripted([[{environment_code:"dev"}],[{active_count:0n}],[{identity_id:1n,player_id:2n,current_display_name:"회원"}],[{result_json:prior,request_hash:"mismatch"}]]);
  await assert.rejects(()=>new MiniPetCreationTicketCraftService(s.database).execute(command),/요청 내용/);
  assert.equal(s.sql.some(q=>q.includes("inventory_stacks")),false);
 });
 it("rejects noncontiguous bag state before material mutation",async()=>{const s=scripted([[{environment_code:"dev"}],[{active_count:0n}],[{identity_id:1n,player_id:2n,current_display_name:"회원"}],[],
   [{capacity_limit:100,bag_shape_code:"array"}],[{owned_mini_pet_id:70n,sort_index:2}]]);
  const result=await new MiniPetCreationTicketCraftService(s.database).execute(command);assert.equal(result.status,"snapshot_required");assert.equal(s.sql.some(q=>q.includes("INSERT INTO operations")),false);
 });
});
