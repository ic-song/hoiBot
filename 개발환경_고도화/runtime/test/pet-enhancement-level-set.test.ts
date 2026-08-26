import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { isPetEnhancementLevelSetCommandCandidate, parsePetEnhancementLevelSetCommand, PetEnhancementLevelSetService, type PetEnhancementLevelSetResult } from "../src/admin/pet-enhancement-level-set-service.js";

function scriptedDatabase(options: { prior?: PetEnhancementLevelSetResult; targets?: unknown[]; versionConflict?: boolean } = {}) {
  const sql: string[]=[]; let insertId=100n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement:string):Promise<T> => {
      sql.push(statement);
      if (statement.includes("FROM operations")) return [{id:91n,result_json:options.prior ?? null}] as T;
      if (statement.includes("FROM player_profiles")) return (options.targets ?? []) as T;
      throw new Error(`Unexpected query: ${statement}`);
    },
    execute: async (statement:string):Promise<DatabaseWriteResult> => {
      sql.push(statement); insertId+=1n;
      if (options.versionConflict === true && statement.startsWith("UPDATE player_pets")) return {affectedRows:0n,insertId};
      return {affectedRows:1n,insertId};
    }
  };
  const database: DatabaseClient = { ping:async()=>undefined,verifyRollback:async()=>true,query:async()=>{throw new Error("Unexpected query");},
    execute:async()=>{throw new Error("Unexpected execute");},withTransaction:async<T>(work:(value:DatabaseTransaction)=>Promise<T>)=>work(transaction),close:async()=>undefined };
  return {database,sql};
}

describe("pet enhancement level set",()=>{
  it("preserves the legacy candidate guard and parses unsigned bigint values",()=>{
    assert.equal(isPetEnhancementLevelSetCommandCandidate("/펫강화속성 대상 0"),true);
    assert.equal(isPetEnhancementLevelSetCommandCandidate("/펫강화속성잘못"),true);
    assert.deepEqual(parsePetEnhancementLevelSetCommand("/펫강화속성 홍 길동 0"),{targetName:"홍 길동",level:0n});
    assert.deepEqual(parsePetEnhancementLevelSetCommand("/펫강화속성 홍 길동 18446744073709551615"),{targetName:"홍 길동",level:18446744073709551615n});
    for(const value of ["/펫강화속성 홍1 2","/펫강화속성 홍길동 -1","/펫강화속성 홍길동 1 추가","/펫강화속성 홍길동 18446744073709551616"])
      assert.equal(parsePetEnhancementLevelSetCommand(value),null);
  });

  it("updates only the locked player pet and records execution, audit and outbox",async()=>{
    const scripted=scriptedDatabase({targets:[{player_id:41n,pet_id:51n,enhancement_level:3n,version:2n}]});
    const result=await new PetEnhancementLevelSetService(scripted.database).set({message:"/펫강화속성 대상 42",idempotencyKey:"event",sourceEventId:"event",destinationId:"room",operatorId:"7"});
    assert.equal(result.status,"changed"); assert.equal(result.data,"펫강화속성 완료"); assert.equal(result.version,"3");
    const update=scripted.sql.find(value=>value.startsWith("UPDATE player_pets"));
    assert.equal(update,"UPDATE player_pets SET enhancement_level=?,version=version+1 WHERE id=? AND version=?");
    assert.ok(scripted.sql.some(value=>value.includes("command_executions")));
    assert.ok(scripted.sql.some(value=>value.includes("command_audit")));
    assert.ok(scripted.sql.some(value=>value.includes("outbox_messages")));
    assert.ok(scripted.sql.every(value=>!value.includes("enhancement_updated_at")));
  });

  it("returns legacy replies for usage and a missing pet",async()=>{
    const usage=await new PetEnhancementLevelSetService(scriptedDatabase().database).set({message:"/펫강화속성 대상",idempotencyKey:"usage",sourceEventId:"usage",destinationId:"room",operatorId:"7"});
    assert.equal(usage.status,"usage"); assert.equal(usage.data,"올바른 명령어 형식을 사용해주세요. 예: /펫강화속성 [유저명] [강화수]");
    const missing=await new PetEnhancementLevelSetService(scriptedDatabase({targets:[]}).database).set({message:"/펫강화속성 없음 3",idempotencyKey:"missing",sourceEventId:"missing",destinationId:"room",operatorId:"7"});
    assert.equal(missing.status,"missing_pet"); assert.equal(missing.data,"펫이 없습니다.");
  });

  it("reuses a completed idempotent result without another pet mutation",async()=>{
    const prior:PetEnhancementLevelSetResult={status:"changed",data:"펫강화속성 완료",targetPlayerId:"41",targetPetId:"51",previousLevel:"3",level:"42",previousVersion:"2",version:"3",operationId:"91",executionId:"92",auditId:"93",outboxId:"94"};
    const scripted=scriptedDatabase({prior});
    assert.deepEqual(await new PetEnhancementLevelSetService(scripted.database).set({message:"/펫강화속성 대상 42",idempotencyKey:"event",sourceEventId:"event",destinationId:"room",operatorId:"7"}),prior);
    assert.ok(scripted.sql.every(value=>!value.includes("player_profiles")&&!value.startsWith("UPDATE player_pets")));
  });

  it("rejects an optimistic version conflict",async()=>{
    const scripted=scriptedDatabase({targets:[{player_id:41n,pet_id:51n,enhancement_level:3n,version:2n}],versionConflict:true});
    await assert.rejects(()=>new PetEnhancementLevelSetService(scripted.database).set({message:"/펫강화속성 대상 42",idempotencyKey:"event",sourceEventId:"event",destinationId:"room",operatorId:"7"}),/version conflict/);
  });
});
