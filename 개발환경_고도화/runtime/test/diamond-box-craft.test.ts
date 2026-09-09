import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { DiamondBoxCraftService, isDiamondBoxCraftCommand, normalizeDiamondBoxCraftDispatchMessage } from "../src/crafting/diamond-box-craft-service.js";

// 다이아 조합 SQL과 mutation 유무를 기록하는 테스트 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining=[...queryResults]; const sql:string[]=[]; let insertId=1000n;
  const transaction:DatabaseTransaction={
    query:async<T>(statement:string):Promise<T>=>{sql.push(statement);if(remaining.length===0)throw new Error(`Unexpected query: ${statement}`);return remaining.shift() as T;},
    execute:async(statement:string):Promise<DatabaseWriteResult>=>{sql.push(statement);insertId+=1n;return{affectedRows:1n,insertId};}
  };
  const database:DatabaseClient={ping:async()=>undefined,verifyRollback:async()=>true,query:async()=>{throw new Error("Unexpected non-transactional query.");},execute:async()=>{throw new Error("Unexpected non-transactional execute.");},withTransaction:async<T>(work:(value:DatabaseTransaction)=>Promise<T>)=>work(transaction),close:async()=>undefined};
  return{database,sql};
}
const owner={identity_id:11n,player_id:21n};
const items=[{id:52n,code:"ITEM-RWD-052"},{id:53n,code:"ITEM-RWD-053"}];

describe("diamond box craft command policy",()=>{
  it("accepts only no-arg and positive integer forms",()=>{
    for(const message of ["/다이아조합","/다이아조합 1","/다이아조합   999999999999999999"]){assert.equal(isDiamondBoxCraftCommand(message),true);assert.equal(normalizeDiamondBoxCraftDispatchMessage(message),"/다이아조합");}
    for(const message of [undefined,"/다이아조합 ","/다이아조합 0","/다이아조합 1 안내","/다이아조합2"])assert.equal(isDiamondBoxCraftCommand(message),false);
  });
});

describe("diamond box craft service",()=>{
  it("spends stone and point and grants boxes with all ledgers",async()=>{
    const scripted=scriptedDatabase([[owner],[],items,[{item_id:52n,quantity:"5",version:"1"},{item_id:53n,quantity:"2",version:"2"}],[{balance:"3000000000.000",version:"4"}]]);
    const result=await new DiamondBoxCraftService(scripted.database).handle({externalUserId:"kakao-1",channelId:"room-1",message:"/다이아조합 3",eventId:"event-craft"});
    assert.deepEqual([result.status,result.stoneQuantity,result.pointBalance,result.boxQuantity],["crafted","2","1500000000","5"]);
    assert.equal(scripted.sql.filter((statement)=>statement.startsWith("UPDATE inventory_stacks")).length,2);
    for(const fragment of ["INSERT INTO inventory_ledger","UPDATE currency_accounts","INSERT INTO currency_ledger","INSERT INTO command_audit","INSERT INTO outbox_messages"])assert.ok(scripted.sql.some((statement)=>statement.includes(fragment)),fragment);
  });
  it("records stone shortage without inventory or currency update",async()=>{
    const scripted=scriptedDatabase([[owner],[],items,[{item_id:52n,quantity:"1",version:"1"},{item_id:53n,quantity:"2",version:"2"}],[{balance:"3000000000.000",version:"4"}]]);
    const result=await new DiamondBoxCraftService(scripted.database).handle({externalUserId:"kakao-1",channelId:"room-1",message:"/다이아조합 3",eventId:"event-short"});
    assert.equal(result.status,"insufficient_stone");
    assert.equal(scripted.sql.some((statement)=>statement.startsWith("UPDATE inventory_stacks")||statement.startsWith("UPDATE currency_accounts")),false);
  });
  it("returns the stored result without a second mutation",async()=>{
    const replay={status:"crafted",playerId:"21",craftQuantity:"2",stoneQuantity:"3",pointBalance:"2000000000",boxQuantity:"4",outboxId:"8",auditId:"7",data:"stored"} as const;
    const scripted=scriptedDatabase([[owner],[{result_json:JSON.stringify(replay)}]]);
    assert.deepEqual(await new DiamondBoxCraftService(scripted.database).handle({externalUserId:"kakao-1",channelId:"room-1",message:"/다이아조합 2",eventId:"event-replay"}),replay);
    assert.equal(scripted.sql.some((statement)=>statement.startsWith("UPDATE ")||statement.startsWith("INSERT ")),false);
  });
});
