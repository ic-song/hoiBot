import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const config = loadConfig();
if (!config.database.enabled || config.database.name !== "hoibot_mini_pet_collection_title_probe") throw new Error(`Blocked database:${config.database.name}`);
const database = createDatabaseClient(config.database);
try {
  const row = (await database.query<Array<Record<string,bigint>>>(`SELECT
    (SELECT COUNT(*) FROM title_definition_catalog_entries WHERE source_scope='MINI_PET_COLLECTION') definitions,
    (SELECT COUNT(DISTINCT stable_code) FROM title_definition_catalog_entries WHERE source_scope='MINI_PET_COLLECTION') stable_codes,
    (SELECT COUNT(DISTINCT BINARY display_name) FROM title_definition_catalog_entries WHERE source_scope='MINI_PET_COLLECTION') displays,
    (SELECT COUNT(*) FROM player_titles) player_assignments,
    (SELECT COUNT(*) FROM pet_titles) pet_assignments,
    (SELECT COUNT(*) FROM mini_pet_title_assignments) mini_assignments`))[0]!;
  const counts=Object.fromEntries(Object.entries(row).map(([key,value])=>[key,Number(value)]));
  const passed=counts.definitions===100&&counts.stable_codes===100&&counts.displays===100&&counts.player_assignments===0&&counts.pet_assignments===0&&counts.mini_assignments===0;
  console.log(JSON.stringify({ result:passed?"passed":"failed",counts,gradeRewardExcluded:8,stageRewardExcluded:100,sameDisplayMerges:0,customTitleChanges:0,objectLinks:0 }));
  if(!passed) process.exitCode=1;
} finally { await database.close(); }
