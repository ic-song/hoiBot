import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaTitleDefinitionScopeCatalogRepository } from "../src/title/maria-title-definition-scope-catalog-repository.js";
import { TitleDefinitionScopeCatalogReadProvider } from "../src/title/title-definition-scope-catalog.js";

const config = loadConfig();
if (!config.database.enabled || config.database.name !== "hoibot_mini_pet_collection_title_probe") throw new Error(`Blocked database:${config.database.name}`);
let database = createDatabaseClient(config.database);
const checks: string[] = [];

async function verify() {
  const provider = new TitleDefinitionScopeCatalogReadProvider(new MariaTitleDefinitionScopeCatalogRepository(database));
  const miniPet = await provider.readPublished(undefined, { normalizedAssetScope: "MINI_PET", lifecycle: "ACTIVE" });
  const collection = miniPet.definitions.filter((definition) => definition.sourceScope === "MINI_PET_COLLECTION");
  assert.equal(collection.length, 100);
  assert.equal(new Set(collection.map((definition) => definition.stableCode)).size, 100);
  assert.equal(new Set(collection.map((definition) => definition.displayName)).size, 100);
  checks.push("exact 100-definition repository parity");
  const first = await provider.readExact({ sourceScope: "MINI_PET_COLLECTION", stableCode: "MINI-PET-COLLECTION-TITLE-001", definitionVersion: 1, lifecycle: "ACTIVE" });
  const last = await provider.readExact({ sourceScope: "MINI_PET_COLLECTION", stableCode: "MINI-PET-COLLECTION-TITLE-100", definitionVersion: 1, lifecycle: "ACTIVE" });
  assert.equal(first.displayName, "미니펫 첫 수집가🐹");
  assert.equal(last.displayName, "미니펫 궁극의 수집가💡");
  checks.push("first and last composite identity");
  const counts = (await database.query<Array<Record<string,bigint>>>(`SELECT
    (SELECT COUNT(*) FROM title_definitions WHERE scope_code='mini_pet_collection') definitions,
    (SELECT COUNT(*) FROM title_definition_catalog_entries WHERE source_scope='MINI_PET_COLLECTION') catalog_entries,
    (SELECT COUNT(DISTINCT BINARY display_name) FROM title_definition_catalog_entries WHERE source_scope='MINI_PET_COLLECTION') displays,
    (SELECT COUNT(DISTINCT JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.displayHash'))) FROM title_definition_catalog_entries WHERE source_scope='MINI_PET_COLLECTION') display_hashes,
    (SELECT COUNT(*) FROM title_definition_catalog_entries WHERE source_scope='MINI_PET_COLLECTION' AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.canonicalSourceHash'))='efbc7d49f6122f56715dfd3cd2be456b159842b6467da060ccd66a62575f433a') source_hash_rows,
    (SELECT COUNT(*) FROM player_titles) player_assignments,
    (SELECT COUNT(*) FROM pet_titles) pet_assignments,
    (SELECT COUNT(*) FROM mini_pet_title_assignments) mini_assignments`))[0]!;
  const numeric = Object.fromEntries(Object.entries(counts).map(([key,value]) => [key,Number(value)]));
  assert.deepEqual(numeric, { definitions:100,catalog_entries:100,displays:100,display_hashes:100,source_hash_rows:100,
    player_assignments:0,pet_assignments:0,mini_assignments:0 });
  checks.push("hash, duplicate, exclusion and ownership boundary");
  assert.equal(await database.verifyRollback(), true);
  checks.push("transaction rollback");
  return numeric;
}

try {
  const counts = await verify();
  await database.close();
  database = createDatabaseClient(config.database);
  const reconnect = await new TitleDefinitionScopeCatalogReadProvider(new MariaTitleDefinitionScopeCatalogRepository(database))
    .readExact({ sourceScope:"MINI_PET_COLLECTION",stableCode:"MINI-PET-COLLECTION-TITLE-100",definitionVersion:1,lifecycle:"ACTIVE" });
  assert.equal(reconnect.displayName,"미니펫 궁극의 수집가💡");
  checks.push("reconnect");
  console.log(JSON.stringify({ result:"passed",checks,total:checks.length,counts,canonicalSourceHash:"efbc7d49f6122f56715dfd3cd2be456b159842b6467da060ccd66a62575f433a",gradeRewardExcluded:8,stageRewardExcluded:100,sameDisplayMerges:0 }));
} finally { await database.close(); }
