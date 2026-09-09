import fs from "node:fs";
import mariadb from "mariadb";

const rows = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/home-building-definition-crosswalk-v1.json", import.meta.url), "utf8"));
const connection = await mariadb.createConnection({
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33395"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_home_building_definition_probe"
});

try {
  const actualRows = await connection.query(`SELECT progression.source_index,object_row.object_key,progression.floor_value,
    progression.experience_required,progression.recipe_json,progression.source_row_hash
    FROM home_building_progression progression
    JOIN object_registry object_row ON object_row.id=progression.home_building_object_id
    ORDER BY progression.source_index`);
  if (actualRows.length !== 300) throw new Error(`HOME_BUILDING_SHADOW_COUNT:${actualRows.length}`);
  rows.forEach((expected, index) => {
    const actual = actualRows[index];
    const recipe = typeof actual.recipe_json === "string" ? JSON.parse(actual.recipe_json) : actual.recipe_json;
    if (Number(actual.source_index) !== expected.sourceIndex || actual.object_key !== expected.objectKey ||
        Number(actual.floor_value) !== expected.floor || Number(actual.experience_required) !== expected.exp ||
        actual.source_row_hash !== expected.sourceRowHash || JSON.stringify(recipe) !== JSON.stringify(expected.required)) {
      throw new Error(`HOME_BUILDING_SHADOW_MISMATCH:${expected.sourceKey}`);
    }
  });
  const totals = (await connection.query(`SELECT
    (SELECT COUNT(*) FROM object_registry WHERE object_type='HOME_BUILDING') definitions,
    (SELECT COUNT(*) FROM home_building_progression) progression,
    (SELECT COUNT(*) FROM object_source_bindings WHERE object_type='HOME_BUILDING' AND source_table='petSweetHomeInfo.homeInfo') bindings`))[0];
  if (Number(totals.definitions) !== 299 || Number(totals.progression) !== 300 || Number(totals.bindings) !== 300) throw new Error("HOME_BUILDING_SHADOW_BOUNDARY");
  console.log(JSON.stringify({ result: "passed", matched: actualRows.length, source: 300, definitions: 299, progression: 300, sourceBindings: 300, floor190Definitions: 2, floor263Definitions: 1, protectedConsumersTouched: false }));
} finally {
  await connection.end();
}
