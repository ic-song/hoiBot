import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { isPetCharmSetCommandCandidate, parsePetCharmSetCommand, PetCharmSetService, resolvePetCharmAppearance } from "../src/admin/pet-charm-set-service.js";

function scriptedDatabase(queryResults: unknown[]) {
  const remaining=[...queryResults],sql:string[]=[];let insertId=100n;
  const transaction:DatabaseTransaction={query:async<T>(statement:string):Promise<T>=>{sql.push(statement);return remaining.shift() as T;},execute:async(statement:string):Promise<DatabaseWriteResult>=>{sql.push(statement);insertId+=1n;return{affectedRows:1n,insertId};}};
  const database:DatabaseClient={ping:async()=>undefined,verifyRollback:async()=>true,query:async()=>{throw new Error("Unexpected query");},execute:async()=>{throw new Error("Unexpected execute");},withTransaction:async<T>(work:(value:DatabaseTransaction)=>Promise<T>)=>work(transaction),close:async()=>undefined};
  return{database,sql};
}

const definitions=[
  {code:"legacy-sky",display_name:"하늘",metadata_json:{normalEmojis:["🐦"],uniqueEmojis:["🐉"]}},
  {code:"legacy-land",display_name:"땅",metadata_json:{normalEmojis:["🐕"],uniqueEmojis:["🦄"]}},
  {code:"legacy-sea",display_name:"바다",metadata_json:{normalEmojis:["🐟"],uniqueEmojis:["🐳"]}},
  {code:"legacy-egg",display_name:"알",metadata_json:{normalEmojis:["🪺"],uniqueEmojis:[]}}
];

describe("pet charm set",()=>{
  it("uses a full numeric command and blocks prefix collisions",()=>{
    assert.equal(isPetCharmSetCommandCandidate("/매력"),true);
    assert.equal(isPetCharmSetCommandCandidate("/매력 합성 회원 10"),true);
    assert.equal(isPetCharmSetCommandCandidate("/매력박스오픈"),false);
    assert.deepEqual(parsePetCharmSetCommand("/매력 합성 회원 10"),{targetName:"합성 회원",experience:10n});
    assert.equal(parsePetCharmSetCommand("/매력 합성 10 추가"),null);
  });
  it("preserves egg evolution RNG order and unique reply",()=>{
    const values=[0.05,0.4,0.9];let index=0;
    const result=resolvePetCharmAppearance("legacy-egg",definitions,()=>values[index++]!);
    assert.deepEqual(result,{petTypeCode:"legacy-land",imageValue:"🦄",messages:["펫이 탄생했습니다!","축하합니다!!\n🎉유니크 펫이 탄생했습니다🎉"],unique:true});
  });
  it("updates the locked pet and records execution, outbox and audit atomically",async()=>{
    const scripted=scriptedDatabase([[],[{player_id:41n,pet_id:51n,experience:3n,pet_type_code:"legacy-egg",image_value:"🪺",version:2n}],definitions]);
    const values=[0.5,0,0];let index=0;
    const result=await new PetCharmSetService(scripted.database,()=>values[index++]!).set({message:"/매력 합성 회원 10",idempotencyKey:"event",sourceEventId:"event",destinationId:"room",operatorId:"7"});
    assert.equal(result.status,"changed");assert.equal(result.data,"수정완료!\n펫이 탄생했습니다!");
    assert.equal(result.petTypeCode,"legacy-sky");assert.equal(result.imageValue,"🐦");
    assert.ok(scripted.sql.some(sql=>sql.includes("UPDATE player_pets")));
    assert.ok(scripted.sql.some(sql=>sql.includes("outbox_messages")));
    assert.ok(scripted.sql.some(sql=>sql.includes("command_audit")));
  });
});
