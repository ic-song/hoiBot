import assert from "node:assert/strict";
import { describe,it } from "node:test";
import type { DatabaseClient,DatabaseTransaction,DatabaseWriteResult } from "../src/database.js";
import { isMiniPetBulkSaleCommand,MiniPetBulkSaleService,parseMiniPetBulkSaleCommand } from "../src/mini-pet/bulk-sale-service.js";

function scripted(results:unknown[]){const queue=[...results],sql:string[]=[];let insertId=30n;
 const tx:DatabaseTransaction={query:async<T>(s:string):Promise<T>=>{sql.push(s);return(queue.shift()??[])as T;},
 execute:async(s:string):Promise<DatabaseWriteResult>=>{sql.push(s);insertId++;return{affectedRows:1n,insertId};}};
 return{sql,database:{ping:async()=>undefined,verifyRollback:async()=>true,query:tx.query,execute:tx.execute,
 withTransaction:async<T>(work:(v:DatabaseTransaction)=>Promise<T>)=>work(tx),close:async()=>undefined}as DatabaseClient};}
const command={externalUserId:"user",channelId:"room",eventId:"event",message:"/미니펫지정판매 2 3",environmentCode:"dev"as const};
const target=(id:number,index:number,price:string)=>({owned_mini_pet_id:BigInt(id),mini_pet_definition_id:9n,stable_owned_id:`00000000-0000-0000-0000-0000000000${id}`,
 sort_index:index,state_code:null,protected:0,locked:0,bound:0,listed:0,equipped:0,title_count:0n,display_name:`펫${id}`,point_price:price,sellable:1});

describe("mini-pet bulk sale",()=>{
 it("accepts only a complete positive range and rejects reverse ranges before DB",async()=>{
  assert.equal(isMiniPetBulkSaleCommand("/미니펫지정판매"),true);
  assert.deepEqual(parseMiniPetBulkSaleCommand("/미니펫지정판매 2 4"),{start:2,end:4});
  assert.equal(isMiniPetBulkSaleCommand("/미니펫지정판매 2 4 해줘"),false);
  const result=await new MiniPetBulkSaleService(scripted([]).database).execute({...command,message:"/미니펫지정판매 4 2"});
  assert.equal(result.status,"invalid_range");
 });
 it("sells the locked range once and aggregates policy proceeds",async()=>{
  const s=scripted([[{environment_code:"dev"}],[{identity_id:1n,player_id:1n}],[],[target(7,2,"5000.000"),target(8,3,"7000.000")],[{balance:"1000.000",version:2n}],[]]);
  const result=await new MiniPetBulkSaleService(s.database).execute(command);
  assert.equal(result.status,"sold");assert.equal(result.soldCount,2);assert.equal(result.pointDelta,"12000");assert.equal(result.pointBalance,"13000");
  assert.equal(s.sql.filter(sql=>sql.includes("UPDATE mini_pet_owned_lifecycle")).length,2);
  assert.equal(s.sql.filter(sql=>sql.includes("INSERT INTO mini_pet_bulk_sale_entries")).length,2);
 });
 it("blocks the whole range before operation when one target is protected",async()=>{
  const s=scripted([[{environment_code:"dev"}],[{identity_id:1n,player_id:1n}],[],[target(7,2,"5000.000"),{...target(8,3,"7000.000"),protected:1}]]);
  const result=await new MiniPetBulkSaleService(s.database).execute(command);
  assert.equal(result.status,"sale_blocked");assert.equal(s.sql.some(sql=>sql.includes("INSERT INTO operations")),false);
 });
 it("replays the prior range without selecting newly reindexed pets",async()=>{
  const prior={status:"sold"as const,soldCount:2,pointDelta:"12000"};
  const s=scripted([[{environment_code:"dev"}],[{identity_id:1n,player_id:1n}],[{result_json:prior}]]);
  const result=await new MiniPetBulkSaleService(s.database).execute(command);
  assert.equal(result.replayed,true);assert.equal(s.sql.some(sql=>sql.includes("mini_pet_bulk_sale_entries")),false);
 });
});
