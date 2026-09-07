import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {loadConfig} from "../src/config.js";
import {createDatabaseClient} from "../src/database.js";
import {MariaCanonicalPetSkillRepository} from "../src/pet/maria-canonical-pet-skill-repository.js";
import {MariaCanonicalPetSkillReadSeeder,projectCanonicalPetSkillSeed,type LegacyPetSkillSeedEntry} from "../src/pet/canonical-pet-skill-read-seed.js";
import {MariaPetSkillInfoMetadataSeeder} from "../src/pet/pet-skill-info-metadata-seed.js";

interface PostFreeze{sourceHash:string;sourceRef:string;rows:Array<LegacyPetSkillSeedEntry&{runtimeSourceIndex:number}>;}
const runtimeRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const fixtureRoot=path.resolve(runtimeRoot,"..","migration-control","fixtures","synthetic-relational");
const baseline=JSON.parse(await fs.readFile(path.join(fixtureRoot,"pet-skill-definitions-v2400.json"),"utf8"))as LegacyPetSkillSeedEntry[];
const additions=JSON.parse(await fs.readFile(path.join(fixtureRoot,"pet-skill-post-freeze-v2435.json"),"utf8"))as PostFreeze;
const entries=[...baseline];for(const addition of [...additions.rows].sort((a,b)=>a.runtimeSourceIndex-b.runtimeSourceIndex))entries.splice(addition.runtimeSourceIndex,0,addition);
const projection=projectCanonicalPetSkillSeed(entries,{S:10.5,A:18.1,B:20,C:47.7},additions.sourceHash);
const config=loadConfig();if(!config.database.enabled)throw new Error("DATABASE_ENABLED must be true to seed canonical pet-skill reads.");
const database=createDatabaseClient(config.database);
try{
  const repository=new MariaCanonicalPetSkillRepository(database);
  for(const row of projection.definitions)await repository.registerDefinition({actor:"canonical-pet-skill-read-seed",sourceSystem:"LEGACY_JSON",sourceNamespace:"PET_SKILL_LIST",sourceIdentifier:row.sourceKey,petSkillName:row.source.name,petSkillDescription:row.source.effect,petSkillGrade:row.source.grade,handlerKey:row.handlerKey,options:row.options});
  await new MariaCanonicalPetSkillReadSeeder(database).seed({actor:"canonical-pet-skill-read-seed",sourceSystem:"LEGACY_JSON",sourceNamespace:"PET_SKILL_LIST",projection});
  await new MariaPetSkillInfoMetadataSeeder(database).seed({actor:"pet-skill-info-metadata-seed",projection});
  const counts=(await database.query<Array<{definitions:bigint;imports:bigint;aliases:bigint;policies:bigint}>>("SELECT (SELECT COUNT(*) FROM canonical_pet_skill_definitions WHERE active_flag=TRUE) definitions,(SELECT COUNT(*) FROM canonical_pet_skill_definition_imports WHERE source_system='LEGACY_JSON' AND source_namespace='PET_SKILL_LIST') imports,(SELECT COUNT(*) FROM canonical_pet_skill_aliases WHERE active_flag=TRUE) aliases,(SELECT COUNT(*) FROM canonical_pet_skill_draw_grade_policies WHERE active_flag=TRUE) policies"))[0]!;
  const actual=[Number(counts.definitions),Number(counts.imports),Number(counts.aliases),Number(counts.policies)],expected=[93,93,30,4];if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error(`CANONICAL_PET_SKILL_SEED_COUNT_DRIFT:${actual.join(",")}`);
  process.stdout.write(`canonical-pet-skill-read-seed definitions=93 imports=93 aliases=30 policies=4 sourceRef=${additions.sourceRef} tupleHash=${projection.canonicalTupleHash}\n`);
}finally{await database.close();}
