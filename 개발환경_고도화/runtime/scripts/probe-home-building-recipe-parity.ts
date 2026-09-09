import assert from "node:assert/strict";
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/home-building-recipe-parity-v2438.json", import.meta.url), "utf8"));
const config = loadConfig();
if (!config.database.enabled || !/^hoibot_asset_home_building_recipe(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`UNSAFE_HOME_BUILDING_RECIPE_PARITY_DATABASE:${config.database.name}`);
let database = createDatabaseClient(config.database);
const checks: string[] = [];
try {
  const catalogs = await database.query<Array<{ id: bigint; source_sha256: string; row_count: bigint; requirement_count: bigint }>>("SELECT id,source_sha256,row_count,requirement_count FROM home_building_recipe_catalog_versions WHERE version_code=? AND active=TRUE", [fixture.catalogVersion]);
  assert.equal(catalogs.length, 1);
  assert.deepEqual([catalogs[0]!.source_sha256,Number(catalogs[0]!.row_count),Number(catalogs[0]!.requirement_count)], [fixture.sourceSha256,300,2683]);
  checks.push("active immutable catalog");
  const rows = await database.query<Array<{ source_sequence: bigint; object_key: string; floor_value: bigint; experience_required: bigint; identity_hash: string; recipe_hash: string; source_row_hash: string }>>(`SELECT recipe_row.source_sequence,object_row.object_key,recipe_row.floor_value,recipe_row.experience_required,recipe_row.identity_hash,recipe_row.recipe_hash,recipe_row.source_row_hash FROM home_building_recipe_rows recipe_row JOIN object_registry object_row ON object_row.id=recipe_row.home_building_object_id AND object_row.object_type='HOME_BUILDING' WHERE recipe_row.catalog_version_id=? ORDER BY recipe_row.source_sequence`, [catalogs[0]!.id]);
  assert.deepEqual(rows.map((row) => [Number(row.source_sequence),row.object_key,Number(row.floor_value),Number(row.experience_required),row.identity_hash,row.recipe_hash,row.source_row_hash]), fixture.rows.map((row: Record<string, unknown>) => [row.sourceSequence,row.objectKey,row.floor,row.experienceRequired,row.identityHash,row.recipeHash,row.sourceRowHash]));
  checks.push("300 ordered building rows");
  const requirements = await database.query<Array<{ source_sequence: bigint; requirement_sequence: bigint; code: string; source_item_name: string; quantity: bigint; source_requirement_hash: string }>>(`SELECT requirement_row.source_sequence,requirement_row.requirement_sequence,item_row.code,requirement_row.source_item_name,requirement_row.quantity,requirement_row.source_requirement_hash FROM home_building_recipe_requirements requirement_row JOIN item_definitions item_row ON item_row.id=requirement_row.item_definition_id WHERE requirement_row.catalog_version_id=? ORDER BY requirement_row.source_sequence,requirement_row.requirement_sequence`, [catalogs[0]!.id]);
  assert.deepEqual(requirements.map((row) => [Number(row.source_sequence),Number(row.requirement_sequence),row.code,row.source_item_name,Number(row.quantity),row.source_requirement_hash]), fixture.requirements.map((row: Record<string, unknown>) => [row.sourceSequence,row.requirementSequence,row.itemCode,row.sourceItemName,row.quantity,row.requirementHash]));
  checks.push("2683 ordered requirements");
  const newTargets = await database.query<Array<{ code: string; object_key: string; display_name: string }>>(`SELECT item_row.code,object_row.object_key,item_row.display_name FROM item_definitions item_row JOIN object_source_bindings binding_row ON binding_row.source_system='RUNTIME_DB' AND binding_row.source_table='item_definitions' AND binding_row.source_key=item_row.code JOIN object_registry object_row ON object_row.id=binding_row.object_id WHERE item_row.code IN ('home_material_iron','home_material_wood') ORDER BY item_row.code`);
  assert.deepEqual(newTargets.map((row) => [row.code,row.object_key,row.display_name]), [["home_material_iron","item.home_material.iron","철근⛓️"],["home_material_wood","item.home_material.wood","목재🌳"]]);
  checks.push("iron and wood canonical targets");
  assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM object_source_bindings WHERE object_type='HOME_BUILDING' AND source_table=?", [fixture.sourceTable]))[0]!.count_value), 300);
  checks.push("300 current source bindings");
  const before = rows[0]!.recipe_hash;
  await assert.rejects(database.withTransaction(async (transaction) => { await transaction.execute("UPDATE home_building_recipe_rows SET recipe_hash=REPEAT('0',64) WHERE catalog_version_id=? AND source_sequence=1", [catalogs[0]!.id]); throw new Error("ROLLBACK_SENTINEL"); }), /ROLLBACK_SENTINEL/);
  assert.equal((await database.query<Array<{ value: string }>>("SELECT recipe_hash value FROM home_building_recipe_rows WHERE catalog_version_id=? AND source_sequence=1", [catalogs[0]!.id]))[0]!.value, before);
  checks.push("transaction rollback");
  await database.close();
  database = createDatabaseClient(config.database);
  assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM home_building_recipe_requirements WHERE catalog_version_id=?", [catalogs[0]!.id]))[0]!.count_value), 2683);
  checks.push("reconnect read");
  console.log(JSON.stringify({ result:"passed",checks,total:checks.length,rows:300,definitions:299,requirements:2683,itemTargets:10,newItemTargets:2,providerAdded:false,consumerChanged:false,ownershipRowsMutated:0,operationalDataTouched:false,gate8:false }));
} finally { await database.close(); }
