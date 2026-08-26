import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { isTrialTowerAdminModifyCommandCandidate, parseTrialTowerAdminModifyCommand, TrialTowerAdminModifyService } from "../src/trial/trial-tower-admin-modify-service.js";

// 시련의 탑 수정 transaction을 기록하는 합성 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining=[...queryResults],sql:string[]=[];let insertId=100n;
  const transaction:DatabaseTransaction={query:async<T>(statement:string):Promise<T>=>{sql.push(statement);return remaining.shift() as T;},execute:async(statement:string):Promise<DatabaseWriteResult>=>{sql.push(statement);insertId+=1n;return{affectedRows:1n,insertId};}};
  const database:DatabaseClient={ping:async()=>undefined,verifyRollback:async()=>true,query:async()=>{throw new Error("Unexpected query");},execute:async()=>{throw new Error("Unexpected execute");},withTransaction:async<T>(work:(value:DatabaseTransaction)=>Promise<T>)=>work(transaction),close:async()=>undefined};
  return{database,sql};
}

describe("trial tower admin modify",()=>{
  it("keeps the broad legacy candidate and full target-floor parser",()=>{
    assert.equal(isTrialTowerAdminModifyCommandCandidate("/시련의탑수정"),true);
    assert.deepEqual(parseTrialTowerAdminModifyCommand("/시련의탑수정 띄어 쓴 닉네임 77"),{targetName:"띄어 쓴 닉네임",floor:77n});
    assert.equal(parseTrialTowerAdminModifyCommand("/시련의탑수정 닉네임 1 해봐"),null);
  });
  it("changes only the locked current progress and preserves the legacy typo",async()=>{
    const scripted=scriptedDatabase([[],[{player_id:41n,floor:12n,season_key:"current"}]]);
    const result=await new TrialTowerAdminModifyService(scripted.database).modify({message:"/시련의탑수정 합성 회원 77",idempotencyKey:"event",sourceEventId:"event",destinationId:"room",operatorId:"7"});
    assert.equal(result.status,"changed");assert.equal(result.data,"합성 회원[님의 시련의 탑 층수가 77층으로 변경되었습니다.");
    assert.ok(scripted.sql.some(sql=>sql.includes("trial_tower_progress_adjustments")));
    assert.ok(scripted.sql.some(sql=>sql.includes("UPDATE trial_tower_progress")));
  });
  it("queues the legacy missing-data reply without progress mutation",async()=>{
    const scripted=scriptedDatabase([[],[]]);
    const result=await new TrialTowerAdminModifyService(scripted.database).modify({message:"/시련의탑수정 없는 회원 3",idempotencyKey:"missing",sourceEventId:"missing",destinationId:"room",operatorId:"7"});
    assert.equal(result.status,"rejected");assert.equal(result.data,"없는 회원님의 시련의 탑 데이터가 존재하지 않습니다.");
    assert.equal(scripted.sql.some(sql=>sql.includes("UPDATE trial_tower_progress")),false);
  });
});
