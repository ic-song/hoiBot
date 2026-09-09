import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { isMiniPetUpgradeOverrideCommandCandidate, MiniPetUpgradeOverrideService, parseMiniPetUpgradeOverrideCommand, type MiniPetUpgradeOverrideResult } from "../src/admin/mini-pet-upgrade-override-service.js";

function scriptedDatabase(options: { prior?: MiniPetUpgradeOverrideResult; players?: unknown[]; pets?: unknown[]; versionConflict?: boolean } = {}) {
  const sql: string[]=[]; let insertId=90n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement:string):Promise<T> => {
      sql.push(statement);
      if(statement.includes("FROM operations"))return [{result_json:options.prior ?? null}] as T;
      if(statement.includes("FROM player_profiles"))return (options.players ?? [{player_id:41n}]) as T;
      if(statement.includes("FROM owned_mini_pets"))return (options.pets ?? [{id:51n,enhancement_level:3n,version:2n}]) as T;
      throw new Error(`Unexpected query: ${statement}`);
    },
    execute: async (statement:string):Promise<DatabaseWriteResult> => {
      sql.push(statement); insertId+=1n;
      if(options.versionConflict === true && statement.startsWith("UPDATE owned_mini_pets"))return {affectedRows:0n,insertId};
      return {affectedRows:1n,insertId};
    }
  };
  const database: DatabaseClient={ping:async()=>undefined,verifyRollback:async()=>true,query:async()=>{throw new Error("Unexpected query");},
    execute:async()=>{throw new Error("Unexpected execute");},withTransaction:async<T>(work:(value:DatabaseTransaction)=>Promise<T>)=>work(transaction),close:async()=>undefined};
  return {database,sql};
}

describe("admin mini-pet upgrade override",()=>{
  it("uses strict command boundaries and parses target, bag sequence and 0..300 upgrade",()=>{
    assert.equal(isMiniPetUpgradeOverrideCommandCandidate("/미니펫강화속성"),true);
    assert.equal(isMiniPetUpgradeOverrideCommandCandidate("/미니펫강화속성잘못"),false);
    assert.deepEqual(parseMiniPetUpgradeOverrideCommand("/미니펫강화속성 홍 길동 0 300"),{targetName:"홍 길동",bagSequence:0n,upgrade:300n});
    for(const value of ["/미니펫강화속성 대상 1 -1","/미니펫강화속성 대상 1 301","/미니펫강화속성 대상 1 2 추가","/미니펫강화속성 대상 1x 2"])
      assert.equal(parseMiniPetUpgradeOverrideCommand(value),null);
  });

  it("updates only the locked stable owned mini-pet and records audit and outbox",async()=>{
    const scripted=scriptedDatabase();
    const result=await new MiniPetUpgradeOverrideService(scripted.database).set({message:"/미니펫강화속성 대상 1 42",idempotencyKey:"event",sourceEventId:"event",destinationId:"room",operatorId:"7"});
    assert.equal(result.status,"changed"); assert.equal(result.ownedMiniPetId,"51"); assert.equal(result.version,"3");
    assert.ok(scripted.sql.some(value=>value.startsWith("UPDATE owned_mini_pets SET enhancement_level=?")));
    assert.ok(scripted.sql.some(value=>value.includes("command_executions")));
    assert.ok(scripted.sql.some(value=>value.includes("command_audit")));
    assert.ok(scripted.sql.some(value=>value.includes("outbox_messages")));
  });

  it("keeps the same stable row unchanged when the absolute value is identical",async()=>{
    const scripted=scriptedDatabase({pets:[{id:51n,enhancement_level:42n,version:9n}]});
    const result=await new MiniPetUpgradeOverrideService(scripted.database).set({message:"/미니펫강화속성 대상 1 42",idempotencyKey:"same",sourceEventId:"same",destinationId:"room",operatorId:"7"});
    assert.equal(result.status,"unchanged"); assert.equal(result.version,"9");
    assert.ok(scripted.sql.every(value=>!value.startsWith("UPDATE owned_mini_pets")));
  });

  it("returns usage and missing target results without mini-pet mutation",async()=>{
    const usage=await new MiniPetUpgradeOverrideService(scriptedDatabase().database).set({message:"/미니펫강화속성 대상",idempotencyKey:"usage",sourceEventId:"usage",destinationId:"room",operatorId:"7"});
    assert.equal(usage.status,"usage");
    const scripted=scriptedDatabase({players:[]});
    const missing=await new MiniPetUpgradeOverrideService(scripted.database).set({message:"/미니펫강화속성 없음 1 3",idempotencyKey:"missing",sourceEventId:"missing",destinationId:"room",operatorId:"7"});
    assert.equal(missing.status,"not_found"); assert.ok(scripted.sql.every(value=>!value.startsWith("UPDATE owned_mini_pets")));
  });

  it("replays a completed event and rejects a version conflict",async()=>{
    const prior:MiniPetUpgradeOverrideResult={status:"changed",data:"미니펫강화속성 완료",targetPlayerId:"41",ownedMiniPetId:"51",bagSequence:"1",previousUpgrade:"3",upgrade:"42",previousVersion:"2",version:"3",operationId:"91",executionId:"92",auditId:"93",outboxId:"94"};
    const replay=scriptedDatabase({prior});
    assert.deepEqual(await new MiniPetUpgradeOverrideService(replay.database).set({message:"/미니펫강화속성 대상 1 42",idempotencyKey:"event",sourceEventId:"event",destinationId:"room",operatorId:"7"}),prior);
    assert.ok(replay.sql.every(value=>!value.includes("FROM player_profiles")&&!value.startsWith("UPDATE owned_mini_pets")));
    const conflict=scriptedDatabase({versionConflict:true});
    await assert.rejects(()=>new MiniPetUpgradeOverrideService(conflict.database).set({message:"/미니펫강화속성 대상 1 42",idempotencyKey:"conflict",sourceEventId:"conflict",destinationId:"room",operatorId:"7"}),/version conflict/);
  });
});
