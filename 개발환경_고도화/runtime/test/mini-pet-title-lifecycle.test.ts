import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { isMiniPetTitleLifecycleCommand, MiniPetTitleLifecycleService } from "../src/mini-pet/title-lifecycle-service.js";

function scripted(results: unknown[]) {
  const queue=[...results],sql:string[]=[]; let insertId=100n;
  const tx:DatabaseTransaction={query:async<T>(s:string):Promise<T>=>{sql.push(s);return(queue.shift()??[])as T;},execute:async(s:string):Promise<DatabaseWriteResult>=>{sql.push(s);insertId++;return{affectedRows:1n,insertId};}};
  return {sql,database:{ping:async()=>undefined,verifyRollback:async()=>true,query:tx.query,execute:tx.execute,withTransaction:async<T>(work:(v:DatabaseTransaction)=>Promise<T>)=>work(tx),close:async()=>undefined}as DatabaseClient};
}
const base={externalUserId:"actor",channelId:"title-room",eventId:"event-1",environmentCode:"dev"as const};
const title={title_id:10n,stable_owned_title_id:"00000000-0000-0000-0000-000000000010",display_order:1,display_name:"첫째",sale_price:"10000000000.000",selected:1};

describe("mini-pet title lifecycle",()=>{
  it("accepts only the exact list, comma add, and positive-index remove forms",()=>{
    assert.equal(isMiniPetTitleLifecycleCommand("/미니펫타이틀목록"),true);
    assert.equal(isMiniPetTitleLifecycleCommand("/미니펫타이틀추가 대상, 새 타이틀"),true);
    assert.equal(isMiniPetTitleLifecycleCommand("/미니펫타이틀제거 대상, 1"),true);
    assert.equal(isMiniPetTitleLifecycleCommand("/미니펫타이틀제거 대상, 0"),false);
    assert.equal(isMiniPetTitleLifecycleCommand("/미니펫타이틀목록 설명"),false);
  });
  it("lists the stable order and selected marker in one audited reply",async()=>{
    const s=scripted([[{environment_code:"dev"}],[{identity_id:1n,player_id:2n}],[],[title]]);
    const result=await new MiniPetTitleLifecycleService(s.database).execute({...base,message:"/미니펫타이틀목록"});
    assert.match(result.data!,/1\. 첫째 \[적용중\]/);
    for(const expected of ["INSERT INTO operations","outbox_messages","command_audit"])assert.equal(s.sql.some(x=>x.includes(expected)),true);
  });
  it("adds a stable owned title and auto-selects the first title",async()=>{
    const s=scripted([[{environment_code:"dev"}],[{operator_id:7n}],[],[{player_id:2n,current_display_name:"대상"}],[],[]]);
    const result=await new MiniPetTitleLifecycleService(s.database).execute({...base,message:"/미니펫타이틀추가 대상, 새 타이틀"});
    assert.equal(result.action,"add"); assert.equal(result.selectedStableOwnedTitleId,result.stableOwnedTitleId);
    for(const expected of ["title_definitions","mini_pet_title_owned_states","mini_pet_title_selections","mini_pet_title_lifecycle_events"])assert.equal(s.sql.some(x=>x.includes(expected)),true);
  });
  it("removes the selected stable title, clears selection, and compacts order",async()=>{
    const second={...title,title_id:11n,stable_owned_title_id:"00000000-0000-0000-0000-000000000011",display_order:2,display_name:"둘째",selected:0};
    const s=scripted([[{environment_code:"dev"}],[{operator_id:7n}],[],[{player_id:2n,current_display_name:"대상"}],[title,second],[{stable_owned_title_id:title.stable_owned_title_id}]]);
    const result=await new MiniPetTitleLifecycleService(s.database).execute({...base,message:"/미니펫타이틀제거 대상, 1"});
    assert.equal(result.selectedStableOwnedTitleId,null);
    for(const expected of ["DELETE FROM mini_pet_title_selections","DELETE FROM mini_pet_title_owned_states","display_order=display_order-1"])assert.equal(s.sql.some(x=>x.includes(expected)),true);
  });
  it("replays a completed mutation before target or title lookup",async()=>{
    const prior={status:"completed"as const,action:"add"as const,data:"ok",playerId:"2",stableOwnedTitleId:"stable"};
    const s=scripted([[{environment_code:"dev"}],[{operator_id:7n}],[{result_json:prior}]]);
    const result=await new MiniPetTitleLifecycleService(s.database).execute({...base,message:"/미니펫타이틀추가 대상, 새 타이틀"});
    assert.equal(result.replayed,true); assert.equal(s.sql.some(x=>x.includes("FROM player_profiles")),false);
  });
  it("silently rejectable authorization is represented by a 403 error",async()=>{
    const s=scripted([[{environment_code:"dev"}],[]]);
    await assert.rejects(()=>new MiniPetTitleLifecycleService(s.database).execute({...base,message:"/미니펫타이틀추가 대상, 새 타이틀"}),(error:unknown)=>error instanceof ApplicationError&&error.statusCode===403);
  });
});
