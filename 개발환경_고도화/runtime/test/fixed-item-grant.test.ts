import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { FixedItemGrantService, isFixedItemGrantCommand } from "../src/admin/fixed-item-grant-service.js";

// 고정 아이템 지급 SQL과 mutation을 기록하는 테스트 DB를 만듭니다.
function scripted(queryResults: unknown[]) {
  const left=[...queryResults],sql:string[]=[];let id=800n;
  const tx:DatabaseTransaction={query:async<T>(s:string):Promise<T>=>{sql.push(s);if(left.length===0)throw new Error(`Unexpected query: ${s}`);return left.shift()as T;},execute:async(s:string):Promise<DatabaseWriteResult>=>{sql.push(s);id+=1n;return{affectedRows:1n,insertId:id};}};
  const database:DatabaseClient={ping:async()=>undefined,verifyRollback:async()=>true,query:async()=>{throw new Error("non-tx query");},execute:async()=>{throw new Error("non-tx execute");},withTransaction:async<T>(work:(v:DatabaseTransaction)=>Promise<T>)=>work(tx),close:async()=>undefined};
  return{database,sql};
}
const cases=[
  ["공헌","guild_contribution_medal","길드공헌훈장🌟(/길드공헌 숫자)"],["귀속","mini_pet_unbind_ticket","미니펫귀속해제권🐰(/귀속해제)"],
  ["근당","legacy_carrot_item","🥕당근이세요?"],["땅","land_document","땅문서📜"],["미니엘리트","package_mini_pet_elite_guaranteed","미니펫🐹엘리트확정패키지(/미니펫엘리트오픈)"],
  ["야구","hoi_baseball_package","호이베이스볼⚾️(/투수던집니다)"],["주간","weekly_box","주간상자🌼"],["지갑","hoi_wallet","호이지갑👛(/지갑털기)"],["태초","bag_yakitori_package_10","태초야키토리 10세트🥩(/이랏싸이마쎄)"]
] as const;

describe("fixed item grant command",()=>{
  it("accepts all nine exact comma forms",()=>{for(const[c]of cases){assert.equal(isFixedItemGrantCommand(`/${c}, 대상`),true);assert.equal(isFixedItemGrantCommand(`/${c}2, 대상 회원`),true);}for(const m of["/공헌","/공헌2 대상","/공헌-1, 대상","/태초2, 대상  ","/없는명령, 대상"])assert.equal(isFixedItemGrantCommand(m),false);});
  it("rejects zero and overflow before database",async()=>{for(const m of["/공헌0, 대상","/공헌1000001, 대상"]){const s=scripted([]);await assert.rejects(()=>new FixedItemGrantService(s.database).execute({externalUserId:"a",channelId:"r",eventId:m,message:m}),(e:unknown)=>e instanceof ApplicationError&&e.code==="FIXED_ITEM_GRANT_LIMIT");assert.equal(s.sql.length,0);}});
});
describe("fixed item grant service",()=>{
  it("maps every command to its stable item code",async()=>{for(const[c,code,name]of cases){const s=scripted([[{operator_id:7n}],[],[{player_id:2n}],[{id:41n,display_name:name}],[{quantity:0n,version:1n}]]);const r=await new FixedItemGrantService(s.database).execute({externalUserId:"a",channelId:"r",eventId:`e-${c}`,message:`/${c}, 대상`});assert.equal(r.itemCode,code);assert.equal(r.itemQuantity,"1");}});
  it("writes stack ledger audit execution and outbox atomically",async()=>{const s=scripted([[{operator_id:7n}],[],[{player_id:2n}],[{id:41n,display_name:cases[0][2]}],[{quantity:3n,version:2n}]]);const r=await new FixedItemGrantService(s.database).execute({externalUserId:"a",channelId:"r",eventId:"e",message:"/공헌2, 대상"});assert.equal(r.itemQuantity,"5");for(const f of["UPDATE inventory_stacks","INSERT INTO inventory_ledger","INSERT INTO command_audit","INSERT INTO command_executions","INSERT INTO outbox_messages"])assert.ok(s.sql.some(x=>x.includes(f)),f);});
  it("rejects unauthorized operator without mutation",async()=>{const s=scripted([[]]);await assert.rejects(()=>new FixedItemGrantService(s.database).execute({externalUserId:"x",channelId:"r",eventId:"x",message:"/땅, 대상"}),(e:unknown)=>e instanceof ApplicationError&&e.statusCode===403);assert.equal(s.sql.some(x=>x.includes("inventory_ledger")),false);});
  it("replays stored result without a second grant",async()=>{const stored={status:"granted",commandName:"주간",targetPlayerId:"2",targetName:"대상",itemCode:"weekly_box",itemDisplayName:"주간상자🌼",grantQuantity:"1",itemQuantity:"4",outboxId:"9",auditId:"10",data:"완료"};const s=scripted([[{operator_id:7n}],[{result_json:JSON.stringify(stored)}]]);const r=await new FixedItemGrantService(s.database).execute({externalUserId:"a",channelId:"r",eventId:"e",message:"/주간, 대상"});assert.equal(r.replayed,true);assert.equal(s.sql.some(x=>x.includes("UPDATE inventory_stacks")),false);});
});
