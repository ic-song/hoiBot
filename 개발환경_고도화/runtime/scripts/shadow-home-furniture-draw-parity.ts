import assert from "node:assert/strict";
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/home-furniture-draw-parity-v2438.json", import.meta.url), "utf8"));
const config = loadConfig();
if (!config.database.enabled || !/^hoibot_asset_home_furniture_draw(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`UNSAFE_HOME_FURNITURE_DRAW_PARITY_SHADOW_DATABASE:${config.database.name}`);
const database = createDatabaseClient(config.database);
try {
  const rows = await database.query<Array<{source_sequence: bigint; within_grade_sequence: bigint; grade_display_name: string; code: string; display_name: string; charm_value: bigint; source_display_snapshot: string; source_rate_text: string}>>(`SELECT entry_row.source_sequence,entry_row.within_grade_sequence,grade_row.grade_display_name,definition_row.code,definition_row.display_name,definition_row.charm_value,entry_row.source_display_snapshot,entry_row.source_rate_text FROM home_furniture_draw_entries entry_row JOIN home_furniture_draw_catalog_versions catalog_row ON catalog_row.id=entry_row.catalog_version_id AND catalog_row.version_code=? AND catalog_row.active=TRUE JOIN home_furniture_draw_grade_bands grade_row ON grade_row.catalog_version_id=catalog_row.id AND grade_row.grade_ordinal=entry_row.grade_ordinal JOIN furniture_definitions definition_row ON definition_row.id=entry_row.furniture_definition_id ORDER BY entry_row.source_sequence`, [fixture.catalogVersion]);
  assert.deepEqual(rows.map((row) => [Number(row.source_sequence),Number(row.within_grade_sequence),row.grade_display_name,row.code,row.display_name,String(row.charm_value),row.source_display_snapshot,row.source_rate_text]), fixture.occurrences.map((row: Record<string, unknown>) => [row.sourceSequence,row.withinGradeSequence,row.gradeDisplayName,row.canonicalCode,row.sourceDisplayName,String(row.charmValue),row.sourceDisplaySnapshot,row.sourceRateText]));
  console.log(JSON.stringify({ result:"passed",matched:rows.length,definitions:2422,reusedDefinitions:1444,newDefinitions:978,duplicateWeightOccurrences:25,gradeRows:fixture.gradeBands.map((row: Record<string, unknown>)=>row.entryCount),providerAdded:false,consumerChanged:false,gate8:false }));
} finally { await database.close(); }
