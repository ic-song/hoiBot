import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { MiniPetBattleResetTicketCraftService, isMiniPetBattleResetTicketCraftCommand } from "../src/mini-pet/mini-pet-battle-reset-ticket-craft-service.js";
import { ApplicationError } from "../src/shared/application-error.js";

// 미니펫 전적 초기화권 조합 SQL과 mutation 순서를 기록하는 테스트 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining=[...queryResults],sql:string[]=[];let insertId=700n;
  const transaction:DatabaseTransaction={
    query:async<T>(statement:string):Promise<T>=>{sql.push(statement);if(remaining.length===0)throw new Error(`Unexpected query: ${statement}`);return remaining.shift() as T;},
    execute:async(statement:string):Promise<DatabaseWriteResult>=>{sql.push(statement);insertId+=1n;return{affectedRows:1n,insertId};}
  };
  const database:DatabaseClient={ping:async()=>undefined,verifyRollback:async()=>true,query:async()=>{throw new Error("Unexpected query");},execute:async()=>{throw new Error("Unexpected execute");},withTransaction:async<T>(work:(value:DatabaseTransaction)=>Promise<T>)=>work(transaction),close:async()=>undefined};
  return{database,sql};
}

const owner={identity_id:11n,player_id:21n};
const definitions=[{id:51n,code:"legacy-seasoned-chicken"},{id:52n,code:"legacy-mini-pet-record-reset-ticket"}];
const stacks=[{item_id:51n,code:"legacy-seasoned-chicken",quantity:100n,version:2n},{item_id:52n,code:"legacy-mini-pet-record-reset-ticket",quantity:0n,version:1n}];

describe("mini pet battle reset ticket craft",()=>{
  it("accepts only the exact command",()=>{
    assert.equal(isMiniPetBattleResetTicketCraftCommand("/미니펫전적조합"),true);
    for(const message of ["/미니펫전적조합 ","/미니펫전적조합 1","/미니펫전적조합안내",undefined])assert.equal(isMiniPetBattleResetTicketCraftCommand(message),false);
  });
  it("spends 100 chickens and grants one ticket atomically",async()=>{
    const scripted=scriptedDatabase([[owner],[],definitions,stacks]);
    const result=await new MiniPetBattleResetTicketCraftService(scripted.database).handle({externalUserId:"kakao-11",channelId:"room-1",message:"/미니펫전적조합",eventId:"craft-1"});
    assert.deepEqual({material:result.materialQuantity,ticket:result.ticketQuantity},{material:"0",ticket:"1"});
    for(const fragment of ["UPDATE inventory_stacks","INSERT INTO inventory_ledger","INSERT INTO mini_pet_battle_reset_ticket_craft_events","INSERT INTO command_executions","INSERT INTO command_audit","INSERT INTO outbox_messages"])assert.ok(scripted.sql.some((statement)=>statement.includes(fragment)),fragment);
  });
  it("rejects a shortage before mutation",async()=>{
    const scripted=scriptedDatabase([[owner],[],definitions,[{...stacks[0],quantity:99n},stacks[1]]]);
    await assert.rejects(()=>new MiniPetBattleResetTicketCraftService(scripted.database).handle({externalUserId:"kakao-11",channelId:"room-1",message:"/미니펫전적조합",eventId:"craft-short"}),(error:unknown)=>error instanceof ApplicationError&&error.code==="SEASONED_CHICKEN_REQUIRED");
    assert.equal(scripted.sql.some((statement)=>statement.includes("UPDATE inventory_stacks")),false);
  });
  it("replays a stored event without inventory mutation",async()=>{
    const stored={status:"crafted" as const,playerId:"21",materialQuantity:"0",ticketQuantity:"1",outboxId:"1",data:"stored",auditId:"2"};
    const scripted=scriptedDatabase([[owner],[{result_json:stored}]]);
    assert.deepEqual(await new MiniPetBattleResetTicketCraftService(scripted.database).handle({externalUserId:"kakao-11",channelId:"room-1",message:"/미니펫전적조합",eventId:"craft-replay"}),stored);
    assert.equal(scripted.sql.some((statement)=>statement.includes("inventory_stacks")),false);
  });
});
