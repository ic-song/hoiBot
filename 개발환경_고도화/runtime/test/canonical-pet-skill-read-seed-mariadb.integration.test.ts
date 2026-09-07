import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs";
import {after,describe,it} from "node:test";
import {createDatabaseClient,type DatabaseClient} from "../src/database.js";
import {MariaCanonicalPetSkillRepository} from "../src/pet/maria-canonical-pet-skill-repository.js";
import {MariaCanonicalPetSkillReadSeeder,projectCanonicalPetSkillSeed,type LegacyPetSkillSeedEntry} from "../src/pet/canonical-pet-skill-read-seed.js";

interface PostFreeze{sourceHash:string;rows:Array<LegacyPetSkillSeedEntry&{runtimeSourceIndex:number}>;}
interface SemanticRow{source_identifier:string;payload_fingerprint:string;pet_skill_name:string;pet_skill_description:string;pet_skill_grade:string;legacy_source_key:string;display_order:number;handler_key:string;options_json:string;UPDATE_USER:string;}
const enabled=process.env.WAVE14_PET_SKILL_SEED_MARIADB_TEST==="true";
const required=(name:string)=>process.env[name]??"integration-not-configured";
const baseline=JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pet-skill-definitions-v2400.json",import.meta.url),"utf8"))as LegacyPetSkillSeedEntry[];
const additions=JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pet-skill-post-freeze-v2435.json",import.meta.url),"utf8"))as PostFreeze;
function active93(){const rows=[...baseline];for(const addition of [...additions.rows].sort((a,b)=>a.runtimeSourceIndex-b.runtimeSourceIndex))rows.splice(addition.runtimeSourceIndex,0,addition);return rows;}
function fingerprint(row:ReturnType<typeof projection>["definitions"][number]){return createHash("sha256").update(JSON.stringify([row.source.name,row.source.effect,row.source.grade,row.handlerKey,row.options,true])).digest("hex");}
const projection=()=>projectCanonicalPetSkillSeed(active93(),{S:10.5,A:18.1,B:20,C:47.7},additions.sourceHash);

describe("canonical pet skill read seed MariaDB",{skip:!enabled},()=>{
  let database:DatabaseClient|undefined;
  after(async()=>database?.close());
  it("binds the frozen 93 definitions, 30 aliases, and 4 policies semantically with rollback",async()=>{
    database=createDatabaseClient({enabled:true,host:required("DATABASE_HOST"),port:Number(required("DATABASE_PORT")),user:required("DATABASE_USER"),password:required("DATABASE_PASSWORD"),name:required("DATABASE_NAME"),connectionLimit:5,connectTimeoutMs:5_000});
    const expected=projection(),repository=new MariaCanonicalPetSkillRepository(database);
    for(const row of expected.definitions)await repository.registerDefinition({actor:"wave14-import",sourceSystem:"LEGACY_JSON",sourceNamespace:"PET_SKILL_LIST",sourceIdentifier:row.sourceKey,petSkillName:row.source.name,petSkillDescription:row.source.effect,petSkillGrade:row.source.grade,handlerKey:row.handlerKey,options:row.options});
    const seeder=new MariaCanonicalPetSkillReadSeeder(database);
    await seeder.seed({actor:"wave14-seed",sourceSystem:"LEGACY_JSON",sourceNamespace:"PET_SKILL_LIST",projection:expected});
    const rows=await database.query<SemanticRow[]>("SELECT imports.source_identifier,imports.payload_fingerprint,definitions.pet_skill_name,definitions.pet_skill_description,definitions.pet_skill_grade,definitions.legacy_source_key,definitions.display_order,definitions.handler_key,CAST(definitions.options_json AS CHAR) options_json,definitions.UPDATE_USER FROM canonical_pet_skill_definition_imports imports JOIN canonical_pet_skill_definitions definitions ON definitions.pet_skill_id=imports.pet_skill_id WHERE imports.source_system='LEGACY_JSON' AND imports.source_namespace='PET_SKILL_LIST' ORDER BY definitions.display_order");
    assert.equal(rows.length,93);
    rows.forEach((actual,index)=>{const item=expected.definitions[index]!;assert.deepEqual([actual.source_identifier,actual.payload_fingerprint,actual.pet_skill_name,actual.pet_skill_description,actual.pet_skill_grade,actual.legacy_source_key,Number(actual.display_order),actual.handler_key,JSON.parse(actual.options_json)],[item.sourceKey,fingerprint(item),item.source.name,item.source.effect,item.source.grade,item.sourceKey,item.displayOrder,item.handlerKey,item.options]);});
    const counts=(await database.query<Array<{definitions:bigint;imports:bigint;aliases:bigint;policies:bigint}>>("SELECT (SELECT COUNT(*) FROM canonical_pet_skill_definitions) definitions,(SELECT COUNT(*) FROM canonical_pet_skill_definition_imports WHERE source_system='LEGACY_JSON' AND source_namespace='PET_SKILL_LIST') imports,(SELECT COUNT(*) FROM canonical_pet_skill_aliases WHERE active_flag=TRUE) aliases,(SELECT COUNT(*) FROM canonical_pet_skill_draw_grade_policies WHERE active_flag=TRUE) policies"))[0]!;
    assert.deepEqual([Number(counts.definitions),Number(counts.imports),Number(counts.aliases),Number(counts.policies)],[93,93,30,4]);
    const last=expected.definitions.at(-1)!;await database.execute("UPDATE canonical_pet_skill_definition_imports SET payload_fingerprint=? WHERE source_system='LEGACY_JSON' AND source_namespace='PET_SKILL_LIST' AND source_identifier=?",["0".repeat(64),last.sourceKey]);
    await assert.rejects(seeder.seed({actor:"must-rollback",sourceSystem:"LEGACY_JSON",sourceNamespace:"PET_SKILL_LIST",projection:expected}),/CROSSWALK_INVALID/);
    assert.equal((await database.query<Array<{UPDATE_USER:string}>>("SELECT definitions.UPDATE_USER FROM canonical_pet_skill_definition_imports imports JOIN canonical_pet_skill_definitions definitions ON definitions.pet_skill_id=imports.pet_skill_id WHERE imports.source_system='LEGACY_JSON' AND imports.source_namespace='PET_SKILL_LIST' AND imports.source_identifier='skill_000'"))[0]!.UPDATE_USER,"wave14-seed");
    await database.execute("UPDATE canonical_pet_skill_definition_imports SET payload_fingerprint=? WHERE source_system='LEGACY_JSON' AND source_namespace='PET_SKILL_LIST' AND source_identifier=?",[fingerprint(last),last.sourceKey]);
  });
});
