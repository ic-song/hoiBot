import assert from "node:assert/strict";
import fs from "node:fs";
import { describe,it } from "node:test";
import type { DatabaseClient,DatabaseTransaction } from "../src/database.js";
import { MariaCanonicalPetSkillReadSeeder, projectCanonicalPetSkillSeed, type LegacyPetSkillSeedEntry } from "../src/pet/canonical-pet-skill-read-seed.js";

interface PostFreeze {sourceHash:string;rows:Array<LegacyPetSkillSeedEntry&{runtimeSourceIndex:number}>;}
const baseline=JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pet-skill-definitions-v2400.json",import.meta.url),"utf8")) as LegacyPetSkillSeedEntry[];
const additions=JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pet-skill-post-freeze-v2435.json",import.meta.url),"utf8")) as PostFreeze;

function active93():LegacyPetSkillSeedEntry[]{const rows=[...baseline];for(const addition of [...additions.rows].sort((a,b)=>a.runtimeSourceIndex-b.runtimeSourceIndex))rows.splice(addition.runtimeSourceIndex,0,addition);return rows;}

describe("canonical pet skill read seed crosswalk",()=>{
  it("projects the exact frozen+post-freeze 93 source without name-only identity merging",()=>{
    const rows=active93();
    const projection=projectCanonicalPetSkillSeed(rows,{S:10.5,A:18.1,B:20,C:47.7},additions.sourceHash);
    assert.equal(projection.definitions.length,93);assert.equal(projection.sourceHash,"435a49512498b33295734e7dc864628792a47409b1e818c047d0051b2f15d176");
    assert.equal(new Set(projection.definitions.map(row=>row.sourceKey)).size,93);
    assert.deepEqual(projection.definitions.slice(0,2).map(row=>[row.source.name,row.displayOrder]),[["전설의 몽둥이",1],["청룡언월도",2]]);
    assert.equal(projection.definitions.find(row=>row.source.name==="무쌍귀신")?.displayOrder,30);
    assert.deepEqual(projection.gradePolicies,[{grade:"S",probabilityTotal:10.5,displayOrder:1},{grade:"A",probabilityTotal:18.1,displayOrder:2},{grade:"B",probabilityTotal:20,displayOrder:3},{grade:"C",probabilityTotal:47.7,displayOrder:4}]);
    assert.ok(projection.aliases.some(row=>row.aliasValue==="용용용의 용신 여의주"));
  });
  it("fails closed on source bytes/hash drift and identity collisions",()=>{
    const rows=active93();assert.throws(()=>projectCanonicalPetSkillSeed(rows,{S:10.5},"0".repeat(64)),/SOURCE_DRIFT/);
    assert.throws(()=>projectCanonicalPetSkillSeed([...rows,{...rows[0]!,sourceIndex:999}],{S:10.5},additions.sourceHash),/SOURCE_DRIFT|DUPLICATE/);
  });
  it("seeds all 93 exact import crosswalks in one transaction and rejects partial projections before SQL",async()=>{
    const projection=projectCanonicalPetSkillSeed(active93(),{S:10.5,A:18.1,B:20,C:47.7},additions.sourceHash);let transactions=0;const writes:string[]=[];
    const names=new Map(projection.definitions.map(row=>[row.sourceKey,row.source.name]));const aliases=new Map(projection.aliases.map(row=>[row.normalizedAliasValue,row]));const policies=new Map(projection.gradePolicies.map(row=>[row.grade,row]));
    const transaction:DatabaseTransaction={query:async<T>(sql:string,values:readonly unknown[]=[])=>{if(sql.includes("definition_imports")){const key=String(values[2]);return[{pet_skill_id:`p${key.slice(-7)}`,pet_skill_name:names.get(key)}] as T;}if(sql.includes("canonical_pet_skill_aliases")){const row=aliases.get(String(values[0]))!;const definition=projection.definitions.find(item=>item.sourceKey===row.sourceKey)!;return[{pet_skill_id:`p${definition.sourceKey.slice(-7)}`,alias_value:row.aliasValue}] as T;}if(sql.includes("grade_policies")){const row=policies.get(String(values[0]))!;return[{grade_probability_total:String(row.probabilityTotal),display_order:row.displayOrder}] as T;}throw new Error(`unexpected query ${sql}`);},execute:async(sql)=>{writes.push(sql);return{affectedRows:1n,insertId:0n};}};
    const unsupported=async()=>{throw new Error("unexpected root operation");};const database={ping:unsupported,verifyRollback:unsupported,query:unsupported,execute:unsupported,close:unsupported,withTransaction:async<T>(work:(tx:DatabaseTransaction)=>Promise<T>)=>{transactions+=1;return work(transaction);}} as DatabaseClient;
    await new MariaCanonicalPetSkillReadSeeder(database).seed({actor:"seed-test",sourceSystem:"LEGACY_JSON",sourceNamespace:"PET_SKILL_LIST",projection});
    assert.equal(transactions,1);assert.equal(writes.length,93);writes.forEach(sql=>assert.match(sql,/^UPDATE canonical_pet_skill_definitions/));
    await assert.rejects(new MariaCanonicalPetSkillReadSeeder(database).seed({actor:"seed-test",sourceSystem:"LEGACY_JSON",sourceNamespace:"PET_SKILL_LIST",projection:{...projection,definitions:projection.definitions.slice(1)}}),/SOURCE_DRIFT|PROJECTION_INCOMPLETE/);assert.equal(transactions,1);
  });
});
