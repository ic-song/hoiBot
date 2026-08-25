import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { isMiniPetOwnedSaleCommand, MiniPetOwnedSaleService, parseMiniPetOwnedSaleCommand } from "../src/mini-pet/owned-sale-service.js";

function scriptedDatabase(results: unknown[]) {
  const queue = [...results]; const sql: string[] = []; let insertId = 20n;
  const tx: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => { sql.push(statement); return (queue.shift() ?? []) as T; },
    execute: async (statement: string): Promise<DatabaseWriteResult> => { sql.push(statement); insertId += 1n; return { affectedRows: 1n, insertId }; }
  };
  const database = { ping: async()=>undefined, verifyRollback:async()=>true, query:tx.query, execute:tx.execute,
    withTransaction: async <T>(work:(value:DatabaseTransaction)=>Promise<T>)=>work(tx), close:async()=>undefined } as DatabaseClient;
  return { database, sql };
}

const command = { externalUserId:"user", channelId:"room", eventId:"event", message:"/미니펫판매 2", environmentCode:"dev" as const };
const target = { identity_id:1n, player_id:1n, owned_mini_pet_id:7n, mini_pet_definition_id:3n,
  stable_owned_id:"00000000-0000-0000-0000-000000000007", sort_index:2, state_code:null, lifecycle_version:null,
  protected:0, locked:0, bound:0, listed:0, equipped:0, title_count:0n, display_name:"판매펫", point_price:"5000.000", sellable:1 };

describe("mini-pet owned sale", () => {
  it("accepts only one complete positive bag index", () => {
    assert.equal(isMiniPetOwnedSaleCommand("/미니펫판매"), true);
    assert.equal(parseMiniPetOwnedSaleCommand("/미니펫판매 2"), 2);
    for (const value of ["/미니펫판매 0","/미니펫판매 2 해줘"," /미니펫판매 2"]) assert.equal(isMiniPetOwnedSaleCommand(value), false);
  });
  it("sells one stable owned pet and writes lifecycle, currency, event, audit and outbox", async () => {
    const scripted=scriptedDatabase([[{environment_code:"dev"}],[{identity_id:1n,player_id:1n}],[],[target],[{balance:"1000.000",version:2n}]]);
    const result=await new MiniPetOwnedSaleService(scripted.database).execute(command);
    assert.equal(result.status,"sold"); assert.equal(result.stableOwnedId,target.stable_owned_id);
    assert.equal(result.pointDelta,"5000"); assert.equal(result.pointBalance,"6000");
    for(const token of ["UPDATE mini_pet_owned_lifecycle","INSERT INTO currency_ledger","INSERT INTO mini_pet_sale_events","INSERT INTO command_audit","INSERT INTO outbox_messages"]) assert.ok(scripted.sql.some(sql=>sql.includes(token)));
  });
  it("replays a completed event without selecting or selling the next index", async () => {
    const prior={status:"sold" as const,data:"prior",stableOwnedId:target.stable_owned_id};
    const scripted=scriptedDatabase([[{environment_code:"dev"}],[{identity_id:1n,player_id:1n}],[{result_json:prior}]]);
    const result=await new MiniPetOwnedSaleService(scripted.database).execute(command);
    assert.equal(result.replayed,true); assert.equal(scripted.sql.some(sql=>sql.includes("UPDATE mini_pet_owned_lifecycle")),false);
  });
  it("blocks equipped, protected, linked-title and missing policy targets before mutation", async () => {
    for(const override of [{equipped:1},{protected:1},{title_count:1n},{sellable:null,point_price:null}]){
      const scripted=scriptedDatabase([[{environment_code:"dev"}],[{identity_id:1n,player_id:1n}],[],[{...target,...override}]]);
      const result=await new MiniPetOwnedSaleService(scripted.database).execute(command);
      assert.equal(result.status,"sale_blocked"); assert.equal(scripted.sql.some(sql=>sql.includes("INSERT INTO operations")),false);
    }
  });
});
