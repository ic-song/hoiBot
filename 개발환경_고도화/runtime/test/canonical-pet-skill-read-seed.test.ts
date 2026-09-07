import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs";
import { describe,it } from "node:test";
import type { DatabaseClient,DatabaseTransaction } from "../src/database.js";
import { CANONICAL_PET_SKILL_CANONICAL_TUPLE_HASH, MariaCanonicalPetSkillReadSeeder, projectCanonicalPetSkillSeed, type CanonicalPetSkillSeedProjection, type LegacyPetSkillSeedEntry } from "../src/pet/canonical-pet-skill-read-seed.js";

interface PostFreeze {sourceHash:string;rows:Array<LegacyPetSkillSeedEntry&{runtimeSourceIndex:number}>;}
const baseline=JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pet-skill-definitions-v2400.json",import.meta.url),"utf8")) as LegacyPetSkillSeedEntry[];
const additions=JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pet-skill-post-freeze-v2435.json",import.meta.url),"utf8")) as PostFreeze;

function active93():LegacyPetSkillSeedEntry[]{const rows=[...baseline];for(const addition of [...additions.rows].sort((a,b)=>a.runtimeSourceIndex-b.runtimeSourceIndex))rows.splice(addition.runtimeSourceIndex,0,addition);return rows;}

describe("canonical pet skill read seed crosswalk",()=>{
  it("projects the exact frozen+post-freeze 93 source without name-only identity merging",()=>{
    const rows=active93();
    const projection=projectCanonicalPetSkillSeed(rows,{S:10.5,A:18.1,B:20,C:47.7},additions.sourceHash);
    assert.equal(projection.definitions.length,93);assert.equal(projection.sourceHash,"435a49512498b33295734e7dc864628792a47409b1e818c047d0051b2f15d176");
    assert.equal(projection.canonicalTupleHash,CANONICAL_PET_SKILL_CANONICAL_TUPLE_HASH);
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
  it("pins the full canonical tuple and policies independently from the legacy source hash",()=>{
    const rows=active93(),totals={S:10.5,A:18.1,B:20,C:47.7};
    assert.throws(()=>projectCanonicalPetSkillSeed(rows.map((row,index)=>index===0?{...row,definitionCode:`${row.definitionCode}-tampered`}:row),totals,additions.sourceHash),/CANONICAL_TUPLE_DRIFT/);
    assert.throws(()=>projectCanonicalPetSkillSeed(rows.map((row,index)=>index===0?{...row,sourceKey:"skill_999"}:row),totals,additions.sourceHash),/CANONICAL_TUPLE_DRIFT/);
    assert.throws(()=>projectCanonicalPetSkillSeed(rows,{...totals,S:10.6},additions.sourceHash),/CANONICAL_TUPLE_DRIFT/);
    assert.throws(()=>projectCanonicalPetSkillSeed(rows,{A:18.1,S:10.5,B:20,C:47.7},additions.sourceHash),/CANONICAL_TUPLE_DRIFT/);
  });
  it("seeds all 93 exact import crosswalks in one transaction and rejects partial projections before SQL",async()=>{
    const projection=projectCanonicalPetSkillSeed(active93(),{S:10.5,A:18.1,B:20,C:47.7},additions.sourceHash);let transactions=0;const writes:string[]=[];
    const names=new Map(projection.definitions.map(row=>[row.sourceKey,row.source.name]));const aliases=new Map(projection.aliases.map(row=>[row.normalizedAliasValue,row]));const policies=new Map(projection.gradePolicies.map(row=>[row.grade,row]));
    const transaction:DatabaseTransaction={query:async<T>(sql:string,values:readonly unknown[]=[])=>{if(sql.startsWith("SELECT (SELECT COUNT"))return[{definitions:93n,imports:93n,aliases:30n,policies:4n}]as T;if(sql.startsWith("SELECT definitions.pet_skill_id"))return projection.definitions.map(row=>({pet_skill_id:`p${row.sourceKey.slice(-7)}`,active_flag:1,source_identifier:row.sourceKey}))as T;if(sql.startsWith("SELECT aliases.normalized_alias_value"))return projection.aliases.map(row=>({normalized_alias_value:row.normalizedAliasValue,active_flag:1,source_identifier:row.sourceKey}))as T;if(sql.startsWith("SELECT pet_skill_grade,active_flag"))return projection.gradePolicies.map(row=>({pet_skill_grade:row.grade,active_flag:1}))as T;if(sql.includes("definition_imports")){const key=String(values[2]),definition=projection.definitions.find(row=>row.sourceKey===key)!;const payload=createHash("sha256").update(JSON.stringify([definition.source.name,definition.source.effect,definition.source.grade,definition.handlerKey,definition.options,true])).digest("hex");return[{pet_skill_id:`p${key.slice(-7)}`,pet_skill_name:names.get(key),pet_skill_description:definition.source.effect,pet_skill_grade:definition.source.grade,handler_key:definition.handlerKey,options_json:definition.options,payload_fingerprint:payload}] as T;}if(sql.includes("canonical_pet_skill_aliases")){const row=aliases.get(String(values[0]))!;const definition=projection.definitions.find(item=>item.sourceKey===row.sourceKey)!;return[{pet_skill_id:`p${definition.sourceKey.slice(-7)}`,alias_value:row.aliasValue}] as T;}if(sql.includes("grade_policies")){const row=policies.get(String(values[0]))!;return[{grade_probability_total:String(row.probabilityTotal),display_order:row.displayOrder}] as T;}throw new Error(`unexpected query ${sql}`);},execute:async(sql)=>{writes.push(sql);return{affectedRows:1n,insertId:0n};}};
    const unsupported=async()=>{throw new Error("unexpected root operation");};const database={ping:unsupported,verifyRollback:unsupported,query:unsupported,execute:unsupported,close:unsupported,withTransaction:async<T>(work:(tx:DatabaseTransaction)=>Promise<T>)=>{transactions+=1;return work(transaction);}} as DatabaseClient;
    await new MariaCanonicalPetSkillReadSeeder(database).seed({actor:"seed-test",sourceSystem:"LEGACY_JSON",sourceNamespace:"PET_SKILL_LIST",projection});
    assert.equal(transactions,1);assert.equal(writes.length,93);writes.forEach(sql=>assert.match(sql,/^UPDATE canonical_pet_skill_definitions/));
    await assert.rejects(new MariaCanonicalPetSkillReadSeeder(database).seed({actor:"seed-test",sourceSystem:"LEGACY_JSON",sourceNamespace:"PET_SKILL_LIST",projection:{...projection,definitions:projection.definitions.slice(1)}}),/SOURCE_DRIFT|PROJECTION_INCOMPLETE/);assert.equal(transactions,1);
  });
  it("rejects projection tampering in definition code, handler, options, source order, and policy before SQL",async()=>{
    const projection=projectCanonicalPetSkillSeed(active93(),{S:10.5,A:18.1,B:20,C:47.7},additions.sourceHash);let transactions=0;
    const never=async()=>{throw new Error("SQL_MUST_NOT_RUN");};const database={ping:never,verifyRollback:never,query:never,execute:never,close:never,withTransaction:async<T>()=>{transactions+=1;throw new Error("SQL_MUST_NOT_RUN");}} as unknown as DatabaseClient;
    const seeder=new MariaCanonicalPetSkillReadSeeder(database),first=projection.definitions[0]!;
    const rejects=async(candidate:CanonicalPetSkillSeedProjection)=>assert.rejects(seeder.seed({actor:"seed-test",sourceSystem:"LEGACY_JSON",sourceNamespace:"PET_SKILL_LIST",projection:candidate}),/SOURCE_DRIFT|CANONICAL_TUPLE_DRIFT|PROJECTION_INCOMPLETE/);
    await rejects({...projection,definitions:[{...first,definitionCode:`${first.definitionCode}-tampered`},...projection.definitions.slice(1)]});
    await rejects({...projection,definitions:[{...first,handlerKey:"command_unlock" as never},...projection.definitions.slice(1)]});
    await rejects({...projection,definitions:[{...first,options:{command:"/tampered"} as never},...projection.definitions.slice(1)]});
    await rejects({...projection,definitions:[projection.definitions[1]!,first,...projection.definitions.slice(2)]});
    await rejects({...projection,gradePolicies:projection.gradePolicies.map((row,index)=>index===0?{...row,probabilityTotal:row.probabilityTotal+0.1}:row)});
    assert.equal(transactions,0);
  });
  it("fails closed on an extra active canonical definition before seed DML",async()=>{
    const projection=projectCanonicalPetSkillSeed(active93(),{S:10.5,A:18.1,B:20,C:47.7},additions.sourceHash);let writes=0;
    const tx:DatabaseTransaction={query:async<T>()=>[{definitions:94n,imports:93n,aliases:30n,policies:4n}]as T,execute:async()=>{writes+=1;return{affectedRows:1n,insertId:0n};}};
    const never=async()=>{throw new Error("unexpected root operation");};const database={ping:never,verifyRollback:never,query:never,execute:never,close:never,withTransaction:async<T>(work:(transaction:DatabaseTransaction)=>Promise<T>)=>work(tx)}as DatabaseClient;
    await assert.rejects(new MariaCanonicalPetSkillReadSeeder(database).seed({actor:"seed-test",sourceSystem:"LEGACY_JSON",sourceNamespace:"PET_SKILL_LIST",projection}),/COUNT_DRIFT/);assert.equal(writes,0);
  });
  it("rejects inactive-expected plus active-extra substitutions for definitions, aliases, and policies",async()=>{
    const projection=projectCanonicalPetSkillSeed(active93(),{S:10.5,A:18.1,B:20,C:47.7},additions.sourceHash);
    const scenarios=[
      {kind:"definition",rows:[...projection.definitions.slice(1).map(row=>({pet_skill_id:row.sourceKey,active_flag:1,source_identifier:row.sourceKey})),{pet_skill_id:projection.definitions[0]!.sourceKey,active_flag:0,source_identifier:projection.definitions[0]!.sourceKey},{pet_skill_id:"unrelated",active_flag:1,source_identifier:null}]},
      {kind:"alias",rows:[...projection.aliases.slice(1).map(row=>({normalized_alias_value:row.normalizedAliasValue,active_flag:1,source_identifier:row.sourceKey})),{normalized_alias_value:projection.aliases[0]!.normalizedAliasValue,active_flag:0,source_identifier:projection.aliases[0]!.sourceKey},{normalized_alias_value:"unrelated",active_flag:1,source_identifier:null}]},
      {kind:"policy",rows:[...projection.gradePolicies.slice(1).map(row=>({pet_skill_grade:row.grade,active_flag:1})),{pet_skill_grade:projection.gradePolicies[0]!.grade,active_flag:0},{pet_skill_grade:"UNRELATED",active_flag:1}]},
    ]as const;
    for(const scenario of scenarios){let writes=0;const tx:DatabaseTransaction={query:async<T>(sql:string)=>{if(sql.startsWith("SELECT (SELECT COUNT"))return[{definitions:93n,imports:93n,aliases:30n,policies:4n}]as T;if(sql.startsWith("SELECT definitions.pet_skill_id"))return(scenario.kind==="definition"?scenario.rows:projection.definitions.map(row=>({pet_skill_id:row.sourceKey,active_flag:1,source_identifier:row.sourceKey})))as T;if(sql.startsWith("SELECT aliases.normalized_alias_value"))return(scenario.kind==="alias"?scenario.rows:projection.aliases.map(row=>({normalized_alias_value:row.normalizedAliasValue,active_flag:1,source_identifier:row.sourceKey})))as T;if(sql.startsWith("SELECT pet_skill_grade,active_flag"))return(scenario.kind==="policy"?scenario.rows:projection.gradePolicies.map(row=>({pet_skill_grade:row.grade,active_flag:1})))as T;throw new Error(`unexpected query ${sql}`);},execute:async()=>{writes+=1;return{affectedRows:1n,insertId:0n};}};const never=async()=>{throw new Error("unexpected root operation");};const database={ping:never,verifyRollback:never,query:never,execute:never,close:never,withTransaction:async<T>(work:(transaction:DatabaseTransaction)=>Promise<T>)=>work(tx)}as DatabaseClient;await assert.rejects(new MariaCanonicalPetSkillReadSeeder(database).seed({actor:"seed-test",sourceSystem:"LEGACY_JSON",sourceNamespace:"PET_SKILL_LIST",projection}),/ACTIVE_SET_DRIFT/);assert.equal(writes,0);}
  });
});
