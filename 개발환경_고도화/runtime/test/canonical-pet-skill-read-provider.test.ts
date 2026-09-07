import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, ReadOnlySnapshotTransaction } from "../src/database.js";
import { MariaCanonicalPetSkillReadProvider, normalizePetSkillLookup, projectCanonicalPetSkillReadCatalog } from "../src/pet/canonical-pet-skill-read-provider.js";

const rows = [
  {pet_skill_id:"skill001",pet_skill_name:"청룡언월도",pet_skill_description:"효과",pet_skill_grade:"S",legacy_source_key:"skill_000",display_order:1,base_draw_rate:"0.1",fixed_draw_rate_flag:1,openable_flag:1,pet_skill_grade_emoji:"📙",required_tier_name:null,tier_exclusive_flag:0,equip_description:null,handler_key:"presentation_only",options_json:{},active_flag:1},
  {pet_skill_id:"skill002",pet_skill_name:"장인의 숨결",pet_skill_description:"효과2",pet_skill_grade:"S",legacy_source_key:"skill_010",display_order:2,base_draw_rate:"1",fixed_draw_rate_flag:0,openable_flag:1,pet_skill_grade_emoji:"📙",required_tier_name:null,tier_exclusive_flag:0,equip_description:null,handler_key:"presentation_only",options_json:{},active_flag:1},
  {pet_skill_id:"skill003",pet_skill_name:"🐉 용용용의 여의주",pet_skill_description:"티어 효과",pet_skill_grade:"S",legacy_source_key:"skill_089",display_order:3,base_draw_rate:"0",fixed_draw_rate_flag:0,openable_flag:0,pet_skill_grade_emoji:"📙",required_tier_name:"용용용",tier_exclusive_flag:1,equip_description:"소원을 말해 봐",handler_key:"presentation_only",options_json:{},active_flag:1},
];
const aliases=[{pet_skill_alias_id:"alias001",pet_skill_id:"skill003",alias_value:"용용용의 여의주",normalized_alias_value:"용용용의여의주"}];
const policies=[{pet_skill_draw_grade_policy_id:"policy01",pet_skill_grade:"S",grade_probability_total:"10.5",display_order:1}];

describe("canonical pet skill read provider",()=>{
  it("redistributes the grade remainder, preserves tier metadata, and orders deterministically",()=>{
    const catalog=projectCanonicalPetSkillReadCatalog([rows[2]!,rows[1]!,rows[0]!],aliases,policies);
    assert.deepEqual(catalog.definitions.map(row=>[row.name,row.actualRate]),[["청룡언월도",0.1/10.5*100],["장인의 숨결",10.4/10.5*100],["🐉 용용용의 여의주",0]]);
    assert.ok(Math.abs(catalog.totalProbability-100)<1e-12);
    assert.deepEqual(catalog.definitions[2],{petSkillId:"skill003",name:"🐉 용용용의 여의주",description:"티어 효과",grade:"S",gradeEmoji:"📙",legacySourceKey:"skill_089",displayOrder:3,baseDrawRate:0,actualRate:0,fixedDrawRate:false,openable:false,requiredTierName:"용용용",tierExclusive:true,equipDescription:"소원을 말해 봐",handlerKey:"presentation_only",options:{},aliases:["용용용의 여의주"]});
  });

  it("fails closed on collisions, incomplete semantics, and unassigned policy mass",()=>{
    assert.throws(()=>projectCanonicalPetSkillReadCatalog(rows,[...aliases,{...aliases[0]!,pet_skill_alias_id:"alias002",pet_skill_id:"skill001"}],policies),/ALIAS_DUPLICATE/);
    assert.throws(()=>projectCanonicalPetSkillReadCatalog([{...rows[0]!,legacy_source_key:" "},rows[1]!,rows[2]!],aliases,policies),/METADATA_INCOMPLETE/);
    assert.throws(()=>projectCanonicalPetSkillReadCatalog(rows,aliases,[...policies,{pet_skill_draw_grade_policy_id:"policy02",pet_skill_grade:"A",grade_probability_total:"1",display_order:2}]),/PROBABILITY_UNASSIGNED/);
    assert.throws(()=>projectCanonicalPetSkillReadCatalog([{...rows[0]!,base_draw_rate:"11"},rows[1]!,rows[2]!],aliases,policies),/PROBABILITY_INCOMPLETE/);
  });

  it("keeps explicit legacy rates for grades without redistribution policies",()=>{
    const ss={...rows[0]!,pet_skill_id:"skill004",pet_skill_name:"탈세자",pet_skill_grade:"SS",legacy_source_key:"skill_001",display_order:4,base_draw_rate:"0.2",fixed_draw_rate_flag:0};
    const catalog=projectCanonicalPetSkillReadCatalog([...rows,ss],aliases,policies);
    assert.equal(catalog.definitions.find(row=>row.petSkillId==="skill004")?.actualRate,0.2/10.7*100);
    assert.ok(Math.abs(catalog.totalProbability-100)<1e-12);
  });

  it("uses exactly one query-only consistent snapshot and three SELECTs",async()=>{
    const sql:string[]=[];let snapshots=0;
    const snapshot:ReadOnlySnapshotTransaction={query:async<T>(query:string)=>{sql.push(query);return (query.includes("aliases")?aliases:query.includes("grade_policies")?policies:rows) as T;}};
    const unsupported=async()=>{throw new Error("unexpected mutable path");};
    const database={ping:unsupported,verifyRollback:unsupported,query:unsupported,execute:unsupported,withTransaction:unsupported,close:unsupported,withControlledTransaction:unsupported,withReadOnlySnapshot:async<T>(work:(tx:ReadOnlySnapshotTransaction)=>Promise<T>)=>{snapshots+=1;return work(snapshot);}} as unknown as DatabaseClient;
    const provider=new MariaCanonicalPetSkillReadProvider(database);
    assert.equal((await provider.resolve("📙 용용용의 여의주")).petSkillId,"skill003");
    assert.equal(snapshots,1);assert.equal(sql.length,3);sql.forEach(query=>assert.match(query,/^SELECT /));
  });

  it("normalizes the exact legacy book prefix and compact lookup aliases",async()=>{
    assert.equal(normalizePetSkillLookup("[펏스킬북]✨ 장인의 숨결📙"),normalizePetSkillLookup("장인의숨결"));
  });

  it("rejects clients without the read-only snapshot capability",async()=>{
    const unsupported=async()=>{throw new Error("unexpected");};
    const database={ping:unsupported,verifyRollback:unsupported,query:unsupported,execute:unsupported,withTransaction:async<T>(_work:(tx:DatabaseTransaction)=>Promise<T>)=>unsupported(),close:unsupported} as DatabaseClient;
    await assert.rejects(new MariaCanonicalPetSkillReadProvider(database).readCatalog(),/SNAPSHOT_CAPABILITY_REQUIRED/);
  });
});
