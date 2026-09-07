import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs";
import {describe,it} from "node:test";
import type {AppWiringReadParticipant} from "../src/dispatch/app-wiring-operation-provider.js";
import {computePetSkillReadinessSemanticFingerprint,formatPetSkillCatalogReadinessReply,MariaCanonicalPetSkillReadinessProvider,PET_SKILL_READINESS_SEMANTIC_FINGERPRINT} from "../src/pet/canonical-pet-skill-readiness-provider.js";
import {projectCanonicalPetSkillSeed,type LegacyPetSkillSeedEntry} from "../src/pet/canonical-pet-skill-read-seed.js";
import {createEnvironmentContext,verifyStartupDatabaseIdentity} from "../src/runtime/environment-context.js";
import type {DatabaseClient} from "../src/database.js";

const expectedCounts={definitions:93,imports:93,aliases:30,policies:4};
interface PostFreeze{sourceHash:string;rows:Array<LegacyPetSkillSeedEntry&{runtimeSourceIndex:number}>}
const baseline=JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pet-skill-definitions-v2400.json",import.meta.url),"utf8"))as LegacyPetSkillSeedEntry[];
const additions=JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pet-skill-post-freeze-v2435.json",import.meta.url),"utf8"))as PostFreeze;
const active93=()=>{const rows=[...baseline];for(const addition of[...additions.rows].sort((a,b)=>a.runtimeSourceIndex-b.runtimeSourceIndex))rows.splice(addition.runtimeSourceIndex,0,addition);return rows;};
const projection=projectCanonicalPetSkillSeed(active93(),{S:10.5,A:18.1,B:20,C:47.7},additions.sourceHash);
const policies=[
  {pet_skill_draw_grade_policy_id:"policy01",pet_skill_grade:"S",grade_probability_total:"10.5",display_order:1,active_flag:1},
  {pet_skill_draw_grade_policy_id:"policy02",pet_skill_grade:"A",grade_probability_total:"18.1",display_order:2,active_flag:1},
  {pet_skill_draw_grade_policy_id:"policy03",pet_skill_grade:"B",grade_probability_total:"20",display_order:3,active_flag:1},
  {pet_skill_draw_grade_policy_id:"policy04",pet_skill_grade:"C",grade_probability_total:"47.7",display_order:4,active_flag:1}
];
const petSkillIdBySource=new Map(projection.definitions.map((row,index)=>[row.sourceKey,`s${String(index).padStart(7,"0")}`]));
const definitions=projection.definitions.map((row,index)=>({pet_skill_id:petSkillIdBySource.get(row.sourceKey)!,pet_skill_name:row.source.name,pet_skill_description:row.source.effect,pet_skill_grade:row.source.grade,legacy_source_key:row.sourceKey,display_order:row.displayOrder,base_draw_rate:String(row.source.rate??0),fixed_draw_rate_flag:row.source.fixedRate===true?1:0,openable_flag:row.source.openable!==false?1:0,pet_skill_grade_emoji:"📙",required_tier_name:row.source.requiredTier??null,tier_exclusive_flag:row.source.tierExclusive===true?1:0,equip_description:row.source.equipComment??null,handler_key:row.handlerKey,options_json:row.options,raid_charm_bonus:String(Number(row.source.raidExp??0)),castle_charm_bonus:String(Number(row.source.castleExp??0)),active_flag:1,source_identifier:row.sourceKey,payload_fingerprint:createHash("sha256").update(JSON.stringify([row.source.name,row.source.effect,row.source.grade,row.handlerKey,row.options,true])).digest("hex")}));
const aliases=projection.aliases.map((row,index)=>({pet_skill_alias_id:`a${String(index).padStart(7,"0")}`,pet_skill_id:petSkillIdBySource.get(row.sourceKey)!,source_identifier:row.sourceKey,alias_type:"legacy_name",alias_value:row.aliasValue,normalized_alias_value:row.normalizedAliasValue,active_flag:1}));

async function environment(databaseIdentity="pet_skill_readiness"){
  const database={query:async<T>()=>[{database_identity:databaseIdentity}] as T} as unknown as DatabaseClient;
  return verifyStartupDatabaseIdentity(database,createEnvironmentContext({environmentCode:"dev",databaseIdentity}));
}
function participant(counts=expectedCounts,identity="pet_skill_readiness",tamper?:"definition"|"swap"|"coordinated"|"import"|"policy"|"alias"|"charm"){
  const sql:string[]=[];
  const semanticDefinitions=definitions.map(row=>({...row}));
  if(tamper==="definition")semanticDefinitions[0]={...semanticDefinitions[0]!,display_order:semanticDefinitions[1]!.display_order};
  if(tamper==="swap"){const first=semanticDefinitions[0]!.display_order;semanticDefinitions[0]={...semanticDefinitions[0]!,display_order:semanticDefinitions[1]!.display_order};semanticDefinitions[1]={...semanticDefinitions[1]!,display_order:first};}
  if(tamper==="coordinated"){const row=semanticDefinitions[0]!,name=`${row.pet_skill_name}-변조`;semanticDefinitions[0]={...row,pet_skill_name:name,payload_fingerprint:createHash("sha256").update(JSON.stringify([name,row.pet_skill_description,row.pet_skill_grade,row.handler_key,row.options_json,true])).digest("hex")};}
  if(tamper==="import")semanticDefinitions[0]={...semanticDefinitions[0]!,payload_fingerprint:"0".repeat(64)};
  if(tamper==="charm")semanticDefinitions[0]={...semanticDefinitions[0]!,raid_charm_bonus:String(Number(semanticDefinitions[0]!.raid_charm_bonus)+1)};
  const semanticAliases=tamper==="alias"?[{...aliases[0]!,alias_value:"잘못된별칭",normalized_alias_value:"잘못된별칭"},...aliases.slice(1)]:aliases;
  const policyRows=tamper==="policy"?[{...policies[0]!,grade_probability_total:"10.6"},...policies.slice(1)]:policies;
  const query=async<T>(statement:string)=>{sql.push(statement);if(statement.includes("SELECT DATABASE() database_identity"))return[{database_identity:identity,...counts}]as T;if(statement.includes("SELECT definition.pet_skill_id"))return semanticDefinitions as T;if(statement.includes("SELECT import_row.source_identifier,alias_row.alias_type"))return semanticAliases as T;if(statement.startsWith("SELECT pet_skill_grade"))return policyRows as T;if(statement.includes("FROM canonical_pet_skill_aliases"))return aliases as T;if(statement.includes("FROM canonical_pet_skill_draw_grade_policies"))return policies as T;if(statement.includes("FROM canonical_pet_skill_definitions"))return definitions as T;throw new Error(`UNEXPECTED_SQL:${statement}`);};
  return{participant:{query}as AppWiringReadParticipant,sql};
}

describe("canonical pet skill DEV readiness",()=>{
  it("classifies empty, partial, and exact complete sets without DML",async()=>{
    const verified=await environment(),provider=new MariaCanonicalPetSkillReadinessProvider();
    const empty=participant({definitions:0,imports:0,aliases:0,policies:0});assert.deepEqual(await provider.inspect(empty.participant,verified),{status:"UNREADY",reasonCode:"EMPTY",counts:{definitions:0,imports:0,aliases:0,policies:0}});
    const partial=participant({definitions:92,imports:92,aliases:29,policies:3});assert.deepEqual(await provider.inspect(partial.participant,verified),{status:"PARTIAL",reasonCode:"COUNT_MISMATCH",counts:{definitions:92,imports:92,aliases:29,policies:3}});
    const ready=participant();assert.deepEqual(await provider.inspect(ready.participant,verified),{status:"READY",reasonCode:"COMPLETE",counts:expectedCounts});
    assert.ok([...empty.sql,...partial.sql,...ready.sql].every(statement=>statement.trimStart().startsWith("SELECT")));
  });
  it("pins the complete semantic tuple including coordinated substitutions, import payload, aliases, policies, order, and charm",async()=>{
    const verified=await environment(),provider=new MariaCanonicalPetSkillReadinessProvider();
    assert.equal(computePetSkillReadinessSemanticFingerprint(definitions,aliases,policies),PET_SKILL_READINESS_SEMANTIC_FINGERPRINT);
    for(const kind of["definition","swap","coordinated","import","policy","alias","charm"]as const)assert.equal((await provider.inspect(participant(expectedCounts,"pet_skill_readiness",kind).participant,verified)).status,"PARTIAL",kind);
    await assert.rejects(()=>provider.inspect(participant(expectedCounts,"another_database").participant,verified),/DATABASE_IDENTITY_DRIFT/);
  });
  it("formats deterministic exact status replies",()=>{
    assert.equal(formatPetSkillCatalogReadinessReply({status:"UNREADY",reasonCode:"EMPTY",counts:{definitions:0,imports:0,aliases:0,policies:0}}),"[DEV 테스트환경]\n❌ DEV 펫스킬 카탈로그가 준비되지 않았습니다.\n정의: 0/93\n정의 연결: 0/93\n별칭: 0/30\n확률 정책: 0/4");
    assert.equal(formatPetSkillCatalogReadinessReply({status:"PARTIAL",reasonCode:"COUNT_MISMATCH",counts:{definitions:92,imports:92,aliases:29,policies:3}}),"[DEV 테스트환경]\n⚠️ DEV 펫스킬 카탈로그가 일부만 준비되었습니다.\n정의: 92/93\n정의 연결: 92/93\n별칭: 29/30\n확률 정책: 3/4");
  });
});
