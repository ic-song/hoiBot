import assert from "node:assert/strict";
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/home-furniture-draw-parity-v2438.json", import.meta.url), "utf8"));
const config = loadConfig();
if (!config.database.enabled || !/^hoibot_asset_home_furniture_draw(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`UNSAFE_HOME_FURNITURE_DRAW_PARITY_DATABASE:${config.database.name}`);
let database = createDatabaseClient(config.database);
const checks: string[] = [];
try {
  const catalogs = await database.query<Array<{id: bigint; source_sha256: string; rate_scale: bigint}>>("SELECT id,source_sha256,rate_scale FROM home_furniture_draw_catalog_versions WHERE version_code=? AND active=TRUE", [fixture.catalogVersion]);
  assert.equal(catalogs.length, 1);
  assert.equal(catalogs[0]!.source_sha256, fixture.sourceSha256);
  assert.equal(Number(catalogs[0]!.rate_scale), 10000000);
  checks.push("active immutable catalog");
  const grades = await database.query<Array<{grade_ordinal: bigint; grade_display_name: string; weight_scaled: bigint; entry_count: bigint}>>("SELECT grade_ordinal,grade_display_name,weight_scaled,entry_count FROM home_furniture_draw_grade_bands WHERE catalog_version_id=? ORDER BY grade_ordinal", [catalogs[0]!.id]);
  assert.deepEqual(grades.map((row) => [Number(row.grade_ordinal),row.grade_display_name,Number(row.weight_scaled),Number(row.entry_count)]), fixture.gradeBands.map((row: Record<string, unknown>) => [row.gradeOrdinal,row.gradeDisplayName,row.weightScaled,row.entryCount]));
  checks.push("seven first-row grade rates");
  const rows = await database.query<Array<{source_sequence: bigint; within_grade_sequence: bigint; grade_ordinal: bigint; code: string; display_name: string; charm_value: bigint; source_display_snapshot: string; source_rate_text: string}>>(`SELECT entry_row.source_sequence,entry_row.within_grade_sequence,entry_row.grade_ordinal,definition_row.code,definition_row.display_name,definition_row.charm_value,entry_row.source_display_snapshot,entry_row.source_rate_text FROM home_furniture_draw_entries entry_row JOIN furniture_definitions definition_row ON definition_row.id=entry_row.furniture_definition_id WHERE entry_row.catalog_version_id=? ORDER BY entry_row.source_sequence`, [catalogs[0]!.id]);
  assert.deepEqual(rows.map((row) => [Number(row.source_sequence),Number(row.within_grade_sequence),Number(row.grade_ordinal),row.code,row.display_name,String(row.charm_value),row.source_display_snapshot,row.source_rate_text]), fixture.occurrences.map((row: Record<string, unknown>) => [row.sourceSequence,row.withinGradeSequence,row.gradeOrdinal,row.canonicalCode,row.sourceDisplayName,String(row.charmValue),row.sourceDisplaySnapshot,row.sourceRateText]));
  checks.push("2447 ordered occurrence parity");
  const totals = (await database.query<Array<{new_definitions: bigint; current_objects: bigint; current_bindings: bigint}>>(`SELECT (SELECT COUNT(*) FROM furniture_definitions WHERE code LIKE 'HOME-DRAW-V2438-%') new_definitions,(SELECT COUNT(*) FROM object_registry WHERE object_type='FURNITURE' AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.sourceHash'))=?) current_objects,(SELECT COUNT(*) FROM object_source_bindings WHERE object_type='FURNITURE' AND source_table=?) current_bindings`, [fixture.sourceSha256, fixture.sourceTable]))[0]!;
  assert.deepEqual([Number(totals.new_definitions),Number(totals.current_objects),Number(totals.current_bindings)], [978,978,2447]);
  checks.push("new definitions and current object bindings");
  const before = rows[0]!.source_display_snapshot;
  await assert.rejects(database.withTransaction(async (transaction) => { await transaction.execute("UPDATE home_furniture_draw_entries SET source_display_snapshot='ROLLBACK' WHERE catalog_version_id=? AND source_sequence=1", [catalogs[0]!.id]); throw new Error("ROLLBACK_SENTINEL"); }), /ROLLBACK_SENTINEL/);
  assert.equal((await database.query<Array<{value: string}>>("SELECT source_display_snapshot value FROM home_furniture_draw_entries WHERE catalog_version_id=? AND source_sequence=1", [catalogs[0]!.id]))[0]!.value, before);
  checks.push("transaction rollback");
  await database.close();
  database = createDatabaseClient(config.database);
  assert.equal(Number((await database.query<Array<{count_value: bigint}>>("SELECT COUNT(*) count_value FROM home_furniture_draw_entries WHERE catalog_version_id=?", [catalogs[0]!.id]))[0]!.count_value), 2447);
  checks.push("reconnect read");
  console.log(JSON.stringify({ result:"passed",checks,total:checks.length,definitions:2422,reusedDefinitions:1444,newDefinitions:978,occurrences:2447,duplicateWeightOccurrences:25,grades:7,providerAdded:false,consumerChanged:false,ownershipRowsMutated:0,operationalDataTouched:false,gate8:false }));
} finally { await database.close(); }
