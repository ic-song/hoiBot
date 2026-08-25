import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { isPlayerAttributeAdjustCommand, PlayerAttributeAdjustService } from "../src/admin/player-attribute-adjust-service.js";

// 회원 속성 조정 SQL과 mutation을 기록하는 테스트 DB를 만듭니다.
function scripted(queryResults: unknown[]) {
  const left=[...queryResults],sql:string[]=[];let id=900n;
  const tx:DatabaseTransaction={query:async<T>(s:string):Promise<T>=>{sql.push(s);if(left.length===0)throw new Error(`Unexpected query: ${s}`);return left.shift()as T;},execute:async(s:string):Promise<DatabaseWriteResult>=>{sql.push(s);id+=1n;return{affectedRows:1n,insertId:id};}};
  const database:DatabaseClient={ping:async()=>undefined,verifyRollback:async()=>true,query:async()=>{throw new Error("non-tx query");},execute:async()=>{throw new Error("non-tx execute");},withTransaction:async<T>(work:(v:DatabaseTransaction)=>Promise<T>)=>work(tx),close:async()=>undefined};
  return{database,sql};
}

describe("player attribute adjust command",()=>{
  it("accepts only complete increase and decrease forms",()=>{for(const m of["/속성증가 대상 lv 2","/속성감소 대상 회원 point 0"])assert.equal(isPlayerAttributeAdjustCommand(m),true);for(const m of["/속성증가","/속성증가 대상 lv -1","/속성증가 대상 hp 1","/속성증가 대상 lv 1 안내"])assert.equal(isPlayerAttributeAdjustCommand(m),false);});
  it("rejects overflow before database",async()=>{const s=scripted([]);await assert.rejects(()=>new PlayerAttributeAdjustService(s.database).execute({externalUserId:"a",channelId:"r",eventId:"e",message:"/속성증가 대상 lv 9223372036854775808"}),(e:unknown)=>e instanceof ApplicationError&&e.code==="PLAYER_ATTRIBUTE_LIMIT");assert.equal(s.sql.length,0);});
});

describe("player attribute adjust service",()=>{
  it("allows a legacy-compatible negative level result with version lock",async()=>{const s=scripted([[{operator_id:7n}],[],[{player_id:2n}],[{level:3n,version:4n}]]);const r=await new PlayerAttributeAdjustService(s.database).execute({externalUserId:"a",channelId:"r",eventId:"lv",message:"/속성감소 대상 lv 5"});assert.equal(r.afterValue,"-2");assert.ok(s.sql.some(x=>x.includes("UPDATE player_profiles")));assert.equal(s.sql.some(x=>x.includes("currency_ledger")),false);});
  it("writes a negative point balance and currency ledger atomically",async()=>{const s=scripted([[{operator_id:7n}],[],[{player_id:2n}],[{balance:"3.000",version:2n}]]);const r=await new PlayerAttributeAdjustService(s.database).execute({externalUserId:"a",channelId:"r",eventId:"point",message:"/속성감소 대상 point 5"});assert.equal(r.afterValue,"-2");for(const f of["UPDATE currency_accounts","INSERT INTO currency_ledger","INSERT INTO command_audit","INSERT INTO command_executions","INSERT INTO outbox_messages"])assert.ok(s.sql.some(x=>x.includes(f)),f);});
  it("rejects unauthorized operators without mutation",async()=>{const s=scripted([[]]);await assert.rejects(()=>new PlayerAttributeAdjustService(s.database).execute({externalUserId:"x",channelId:"r",eventId:"x",message:"/속성증가 대상 lv 1"}),(e:unknown)=>e instanceof ApplicationError&&e.statusCode===403);assert.equal(s.sql.some(x=>x.includes("operations")),false);});
  it("replays a stored result without a second adjustment",async()=>{const stored={status:"adjusted",targetPlayerId:"2",targetName:"대상",attribute:"lv",direction:"increase",amount:"1",beforeValue:"3",afterValue:"4",outboxId:"9",auditId:"10",data:"완료"};const s=scripted([[{operator_id:7n}],[{result_json:JSON.stringify(stored)}]]);const r=await new PlayerAttributeAdjustService(s.database).execute({externalUserId:"a",channelId:"r",eventId:"e",message:"/속성증가 대상 lv 1"});assert.equal(r.replayed,true);assert.equal(s.sql.some(x=>x.includes("UPDATE player_profiles")),false);});
  it("rejects changed content for the same event",async()=>{const stored={status:"adjusted",targetPlayerId:"2",targetName:"대상",attribute:"lv",direction:"increase",amount:"1",beforeValue:"3",afterValue:"4",outboxId:"9",auditId:"10",data:"완료"};const s=scripted([[{operator_id:7n}],[{result_json:JSON.stringify(stored)}]]);await assert.rejects(()=>new PlayerAttributeAdjustService(s.database).execute({externalUserId:"a",channelId:"r",eventId:"e",message:"/속성감소 대상 lv 1"}),(e:unknown)=>e instanceof ApplicationError&&e.code==="PLAYER_ATTRIBUTE_REPLAY_MISMATCH");assert.equal(s.sql.some(x=>x.includes("UPDATE player_profiles")),false);});
});
