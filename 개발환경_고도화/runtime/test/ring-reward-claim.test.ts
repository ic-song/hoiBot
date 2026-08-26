import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { isRingRewardClaimCommand, RingRewardClaimService, type RingRewardClaimResult } from "../src/ring/ring-reward-claim-service.js";

// 반지 보상 수령 transaction을 순서대로 검증하는 합성 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining=[...queryResults],sql:string[]=[]; let insertId=1000n;
  const tx:DatabaseTransaction={query:async<T>(s:string):Promise<T>=>{sql.push(s);if(!remaining.length)throw new Error(`Unexpected query: ${s}`);return remaining.shift() as T;},execute:async(s:string):Promise<DatabaseWriteResult>=>{sql.push(s);insertId+=1n;return{affectedRows:1n,insertId};}};
  const database:DatabaseClient={ping:async()=>undefined,verifyRollback:async()=>true,query:async()=>{throw new Error("Unexpected query")},execute:async()=>{throw new Error("Unexpected execute")},withTransaction:async<T>(work:(t:DatabaseTransaction)=>Promise<T>)=>work(tx),close:async()=>undefined};
  return{database,sql};
}

describe("ring reward claim command",()=>{
  it("accepts only the exact legacy command",()=>{assert.equal(isRingRewardClaimCommand("/반지보상받기"),true);assert.equal(isRingRewardClaimCommand("/반지보상받기 1"),false);});
  it("grants raid plus castle charm and claims the snapshot once",async()=>{const s=scriptedDatabase([[],[{id:1n}],[{ring_name:"합성반지",ring_grade:"전설",enhancement_level:7n,raid_charm:1200n,castle_charm:800n,claim_status:"pending",reward_quantity:null}],[{id:9n}]]);const result=await new RingRewardClaimService(s.database).claim({playerId:"1",identityId:"2",destinationId:"room",sourceEventId:"event",idempotencyKey:"event"});assert.equal(result.status,"claimed");assert.equal(result.rewardQuantity,"2000");assert.match(result.data,/x2,000/);assert.equal(s.sql.some(x=>x.includes("INSERT INTO inventory_ledger")),true);});
  it("keeps missing ring mutation-free",async()=>{const s=scriptedDatabase([[],[{id:1n}],[]]);const result=await new RingRewardClaimService(s.database).claim({playerId:"1",identityId:"2",destinationId:"room",sourceEventId:"missing",idempotencyKey:"missing"});assert.equal(result.status,"missing_ring");assert.equal(s.sql.some(x=>x.includes("inventory_stacks")||x.includes("inventory_ledger")),false);});
  it("returns a stored result without another grant",async()=>{const stored:RingRewardClaimResult={status:"claimed",data:"stored",outboxId:"1",auditId:"2",rewardQuantity:"3"};const s=scriptedDatabase([[{result_json:JSON.stringify(stored)}]]);const result=await new RingRewardClaimService(s.database).claim({playerId:"1",identityId:"2",destinationId:"room",sourceEventId:"replay",idempotencyKey:"replay"});assert.deepEqual(result,stored);assert.equal(s.sql.some(x=>x.includes("inventory_stacks")),false);});
});
