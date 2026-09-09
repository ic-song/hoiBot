import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { isMiniPetBattleCountAdminCommandCandidate, MiniPetBattleCountAdminService, parseMiniPetBattleCountAdminCommand, type MiniPetBattleCountAdminResult } from "../src/admin/mini-pet-battle-count-admin-service.js";

function scripted(options: { prior?: MiniPetBattleCountAdminResult; players?: unknown[]; daily?: unknown[] } = {}) {
  const sql: string[] = []; let id = 100n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement);
      if (statement.includes("FROM operations")) return [{ result_json:options.prior ?? null }] as T;
      if (statement.includes("FROM player_profiles")) return (options.players ?? [{ player_id:41n }]) as T;
      if (statement.includes("FROM player_pet_daily_records")) return (options.daily ?? [{ record_date:"2026-08-28",mini_battle_attempts:3n,mini_battle_wins:4n,mini_battle_losses:5n,version:1n }]) as T;
      throw new Error(`Unexpected query: ${statement}`);
    },
    execute: async (statement: string): Promise<DatabaseWriteResult> => { sql.push(statement); id += 1n; return { affectedRows:1n,insertId:id }; }
  };
  const database: DatabaseClient = {
    ping:async()=>undefined,verifyRollback:async()=>true,query:async()=>{throw new Error("Unexpected query");},
    execute:async()=>{throw new Error("Unexpected execute");},withTransaction:async<T>(work:(value:DatabaseTransaction)=>Promise<T>)=>work(transaction),close:async()=>undefined
  };
  return { database,sql };
}

describe("admin mini-pet battle count",()=>{
  it("parses only a complete target and unsigned bigint count",()=>{
    assert.equal(isMiniPetBattleCountAdminCommandCandidate("/미니펫대전횟수"),true);
    assert.equal(isMiniPetBattleCountAdminCommandCandidate("/미니펫대전횟수잘못"),false);
    assert.deepEqual(parseMiniPetBattleCountAdminCommand("/미니펫대전횟수 대상 회원 12"),{targetName:"대상 회원",count:12n});
    for (const value of ["/미니펫대전횟수 대상 회원 -1","/미니펫대전횟수 대상 회원 2x","/미니펫대전횟수 대상 회원 2 suffix"])
      assert.equal(parseMiniPetBattleCountAdminCommand(value),null);
  });
  it("sets the daily count while preserving wins and losses",async()=>{
    const value=scripted(); const result=await new MiniPetBattleCountAdminService(value.database).set({message:"/미니펫대전횟수 대상 회원 7",idempotencyKey:"event",sourceEventId:"event",destinationId:"room",operatorId:"7"});
    assert.equal(result.status,"changed");assert.equal(result.wins,"4");assert.equal(result.losses,"5");assert.equal(result.version,"2");
    for(const fragment of ["UPDATE player_pet_daily_records","mini_pet_battle_count_override_events","command_audit","outbox_messages"])
      assert.ok(value.sql.some(statement=>statement.includes(fragment)),fragment);
  });
  it("keeps a missing target mutation-free",async()=>{
    const value=scripted({players:[]});const result=await new MiniPetBattleCountAdminService(value.database).set({message:"/미니펫대전횟수 없는 대상 7",idempotencyKey:"missing",sourceEventId:"missing",destinationId:"room",operatorId:"7"});
    assert.equal(result.status,"not_found");assert.ok(value.sql.every(statement=>!statement.includes("UPDATE player_pet_daily_records")));
  });
  it("replays the stored result without another player or daily query",async()=>{
    const prior:MiniPetBattleCountAdminResult={status:"changed",data:"완료",targetPlayerId:"41",recordDate:"2026-08-28",previousCount:"3",count:"7",wins:"4",losses:"5",previousVersion:"1",version:"2",operationId:"101",executionId:"102",auditId:"103",outboxId:"104"};
    const value=scripted({prior});assert.deepEqual(await new MiniPetBattleCountAdminService(value.database).set({message:"/미니펫대전횟수 대상 회원 7",idempotencyKey:"event",sourceEventId:"event",destinationId:"room",operatorId:"7"}),prior);
    assert.ok(value.sql.every(statement=>!statement.includes("FROM player_profiles")&&!statement.includes("FROM player_pet_daily_records")));
  });
});
