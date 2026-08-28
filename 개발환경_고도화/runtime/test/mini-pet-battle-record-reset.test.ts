import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { MiniPetBattleRecordResetService, isMiniPetBattleRecordResetCommand } from "../src/mini-pet/mini-pet-battle-record-reset-service.js";
import { ApplicationError } from "../src/shared/application-error.js";

// 미니펫 전적 초기화 SQL과 mutation 순서를 기록하는 테스트 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining=[...queryResults],sql:string[]=[];let insertId=800n;
  const transaction:DatabaseTransaction={
    query:async<T>(statement:string):Promise<T>=>{sql.push(statement);if(remaining.length===0)throw new Error(`Unexpected query: ${statement}`);return remaining.shift() as T;},
    execute:async(statement:string):Promise<DatabaseWriteResult>=>{sql.push(statement);insertId+=1n;return{affectedRows:1n,insertId};}
  };
  const database:DatabaseClient={ping:async()=>undefined,verifyRollback:async()=>true,query:async()=>{throw new Error("Unexpected query");},execute:async()=>{throw new Error("Unexpected execute");},withTransaction:async<T>(work:(value:DatabaseTransaction)=>Promise<T>)=>work(transaction),close:async()=>undefined};
  return{database,sql};
}

const owner={identity_id:11n,player_id:21n};
const pet={id:31n};
const definition={id:52n};
const stack={item_id:52n,quantity:2n,version:1n};
const battle={win_count:9n,loss_count:4n,version:2n};
const daily={mini_battle_attempts:7n,mini_battle_wins:9n,mini_battle_losses:4n,version:3n};

describe("mini pet battle record reset",()=>{
  it("accepts only the exact command",()=>{
    assert.equal(isMiniPetBattleRecordResetCommand("/미니펫전적초기화"),true);
    for(const message of ["/미니펫전적초기화 ","/미니펫전적초기화 1","/미니펫전적초기화안내",undefined])assert.equal(isMiniPetBattleRecordResetCommand(message),false);
  });
  it("spends one ticket and resets all battle counters atomically",async()=>{
    const scripted=scriptedDatabase([[owner],[],[pet],[definition],[stack],[battle],[daily]]);
    const result=await new MiniPetBattleRecordResetService(scripted.database).handle({externalUserId:"kakao-11",channelId:"room-1",message:"/미니펫전적초기화",eventId:"reset-1"});
    assert.deepEqual({ticket:result.ticketQuantity,wins:result.previousWinCount,losses:result.previousLossCount,count:result.previousBattleAttempts},{ticket:"1",wins:"9",losses:"4",count:"7"});
    for(const fragment of ["UPDATE inventory_stacks","UPDATE mini_pet_battle_states","UPDATE player_pet_daily_records","INSERT INTO inventory_ledger","INSERT INTO mini_pet_battle_record_reset_events","INSERT INTO command_executions","INSERT INTO command_audit","INSERT INTO outbox_messages"])assert.ok(scripted.sql.some((statement)=>statement.includes(fragment)),fragment);
  });
  it("rejects a missing pet before inventory or record mutation",async()=>{
    const scripted=scriptedDatabase([[owner],[],[]]);
    await assert.rejects(()=>new MiniPetBattleRecordResetService(scripted.database).handle({externalUserId:"kakao-11",channelId:"room-1",message:"/미니펫전적초기화",eventId:"reset-no-pet"}),(error:unknown)=>error instanceof ApplicationError&&error.code==="MINI_PET_DATA_REQUIRED");
    assert.equal(scripted.sql.some((statement)=>statement.includes("UPDATE inventory_stacks")||statement.includes("UPDATE mini_pet_battle_states")),false);
  });
  it("replays a stored event without consuming another ticket",async()=>{
    const stored={status:"reset" as const,playerId:"21",ticketQuantity:"1",previousWinCount:"9",previousLossCount:"4",previousBattleAttempts:"7",outboxId:"1",data:"stored",auditId:"2"};
    const scripted=scriptedDatabase([[owner],[{result_json:stored}]]);
    assert.deepEqual(await new MiniPetBattleRecordResetService(scripted.database).handle({externalUserId:"kakao-11",channelId:"room-1",message:"/미니펫전적초기화",eventId:"reset-replay"}),stored);
    assert.equal(scripted.sql.some((statement)=>statement.includes("inventory_stacks")),false);
  });
});
