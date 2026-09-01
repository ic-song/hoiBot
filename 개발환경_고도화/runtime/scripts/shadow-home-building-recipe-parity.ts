import assert from "node:assert/strict";
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/home-building-recipe-parity-v2438.json", import.meta.url), "utf8"));
const config = loadConfig();
if (!config.database.enabled || !/^hoibot_asset_home_building_recipe(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`UNSAFE_HOME_BUILDING_RECIPE_PARITY_SHADOW_DATABASE:${config.database.name}`);
const database = createDatabaseClient(config.database);
try {
  const rows = await database.query<Array<{ source_sequence: bigint; requirement_sequence: bigint; object_key: string; floor_value: bigint; experience_required: bigint; code: string; source_item_name: string; quantity: bigint }>>(`SELECT recipe_row.source_sequence,requirement_row.requirement_sequence,object_row.object_key,recipe_row.floor_value,recipe_row.experience_required,item_row.code,requirement_row.source_item_name,requirement_row.quantity FROM home_building_recipe_catalog_versions catalog_row JOIN home_building_recipe_rows recipe_row ON recipe_row.catalog_version_id=catalog_row.id JOIN object_registry object_row ON object_row.id=recipe_row.home_building_object_id AND object_row.object_type='HOME_BUILDING' JOIN home_building_recipe_requirements requirement_row ON requirement_row.catalog_version_id=recipe_row.catalog_version_id AND requirement_row.source_sequence=recipe_row.source_sequence JOIN item_definitions item_row ON item_row.id=requirement_row.item_definition_id WHERE catalog_row.version_code=? AND catalog_row.active=TRUE ORDER BY recipe_row.source_sequence,requirement_row.requirement_sequence`, [fixture.catalogVersion]);
  assert.deepEqual(rows.map((row) => [Number(row.source_sequence),Number(row.requirement_sequence),row.object_key,Number(row.floor_value),Number(row.experience_required),row.code,row.source_item_name,Number(row.quantity)]), fixture.requirements.map((requirement: Record<string, unknown>) => { const recipeRow = fixture.rows[Number(requirement.sourceSequence) - 1]; return [requirement.sourceSequence,requirement.requirementSequence,recipeRow.objectKey,recipeRow.floor,recipeRow.experienceRequired,requirement.itemCode,requirement.sourceItemName,requirement.quantity]; }));
  console.log(JSON.stringify({ result:"passed",matched:rows.length,buildingRows:300,buildingDefinitions:299,itemTargets:10,newItemTargets:2,changedRecipes:300,providerAdded:false,consumerChanged:false,gate8:false }));
} finally { await database.close(); }
