import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { CastleTaxRateMutateService, isCastleTaxRateCommand } from "../src/castle/tax-rate-mutate-service.js";

// 캐슬 세율 변경 SQL과 mutation을 기록하는 테스트 DB를 만듭니다.
function scripted(queryResults: unknown[]){const left=[...queryResults],sql:string[]=[];let id=1100n;const tx:DatabaseTransaction={query:async<T>(s:string):Promise<T>=>{sql.push(s);if(left.length===0)throw new Error(`Unexpected query: ${s}`);return left.shift()as T;},execute:async(s:string):Promise<DatabaseWriteResult>=>{sql.push(s);id+=1n;return{affectedRows:1n,insertId:id};}};const database:DatabaseClient={ping:async()=>undefined,verifyRollback:async()=>true,query:async()=>{throw new Error("non-tx query");},execute:async()=>{throw new Error("non-tx execute");},withTransaction:async<T>(work:(v:DatabaseTransaction)=>Promise<T>)=>work(tx),close:async()=>undefined};return{database,sql};}
const command=(message:string,eventId="e")=>({externalUserId:"lord",channelId:"room",eventId,message});

describe("castle tax rate command",()=>{
 it("accepts only one complete numeric argument",()=>{assert.equal(isCastleTaxRateCommand("/세금 5"),true);for(const m of["/세금","/세금 5 안내","/세금 -1","/세금 5.0"])assert.equal(isCastleTaxRateCommand(m),false);});
 it("rejects values over the DB range before transaction queries",async()=>{const s=scripted([]);await assert.rejects(()=>new CastleTaxRateMutateService(s.database).execute(command("/세금 101")),(e:unknown)=>e instanceof ApplicationError&&e.code==="CASTLE_TAX_RANGE");assert.equal(s.sql.length,0);});
});
describe("castle tax rate service",()=>{
 it("allows the normal lord rate 5 and records config audit",async()=>{const s=scripted([[{identity_id:11n,player_id:1n}],[],[{lord_player_id:1n,tax_rate:20,version:2n}],[],[{id:31n}]]);const r=await new CastleTaxRateMutateService(s.database).execute(command("/세금 5"));assert.deepEqual([r.beforeRate,r.afterRate,r.wickedLord],["20","5",false]);for(const f of["UPDATE castle_states","INSERT INTO configuration_change_log","INSERT INTO command_audit","INSERT INTO outbox_messages"])assert.ok(s.sql.some(x=>x.includes(f)),f);});
 it("allows 11 through 30 only with the wicked lord skill",async()=>{const s=scripted([[{identity_id:11n,player_id:1n}],[],[{lord_player_id:1n,tax_rate:5,version:2n}],[{skill_id:9n}],[{id:31n}]]);const r=await new CastleTaxRateMutateService(s.database).execute(command("/세금 30"));assert.equal(r.afterRate,"30");assert.equal(r.wickedLord,true);});
 it("rejects a high rate for a normal lord without mutation",async()=>{const s=scripted([[{identity_id:11n,player_id:1n}],[],[{lord_player_id:1n,tax_rate:5,version:2n}],[]]);await assert.rejects(()=>new CastleTaxRateMutateService(s.database).execute(command("/세금 12")),(e:unknown)=>e instanceof ApplicationError&&e.code==="CASTLE_TAX_NOT_ALLOWED");assert.equal(s.sql.some(x=>x.includes("UPDATE castle_states")),false);});
 it("rejects a non-lord before skill lookup",async()=>{const s=scripted([[{identity_id:11n,player_id:1n}],[],[{lord_player_id:2n,tax_rate:5,version:2n}]]);await assert.rejects(()=>new CastleTaxRateMutateService(s.database).execute(command("/세금 5")),(e:unknown)=>e instanceof ApplicationError&&e.code==="CASTLE_LORD_REQUIRED");assert.equal(s.sql.some(x=>x.includes("player_skill_assignments")),false);});
 it("replays the same rate and rejects changed content",async()=>{const stored={status:"updated",castleCode:"hoi_castle",lordPlayerId:"1",beforeRate:"5",afterRate:"20",wickedLord:true,outboxId:"9",auditId:"10",data:"완료"};let s=scripted([[{identity_id:11n,player_id:1n}],[{result_json:JSON.stringify(stored)}]]);const r=await new CastleTaxRateMutateService(s.database).execute(command("/세금 20"));assert.equal(r.replayed,true);s=scripted([[{identity_id:11n,player_id:1n}],[{result_json:JSON.stringify(stored)}]]);await assert.rejects(()=>new CastleTaxRateMutateService(s.database).execute(command("/세금 21")),(e:unknown)=>e instanceof ApplicationError&&e.code==="CASTLE_TAX_REPLAY_MISMATCH");});
});
