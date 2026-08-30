import fs from "node:fs";
import mariadb from "mariadb";

const rows = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/minipet-definition-crosswalk-v1.json", import.meta.url), "utf8"));
const connection = await mariadb.createConnection({
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33392"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_minipet_definition_probe"
});

try {
  const records = await connection.query(
    "SELECT b.source_index,b.source_key,b.compatibility_code,d.code canonical_code,d.display_name,d.grade_code,d.grade_display_name,d.emoji_value " +
    "FROM mini_pet_definition_source_bindings b JOIN mini_pet_definitions d ON d.id=b.mini_pet_definition_id ORDER BY b.source_index"
  );
  if (records.length !== 1078) throw new Error(`MINIPET_SHADOW_COUNT:${records.length}`);
  for (let index = 0; index < rows.length; index += 1) {
    const expected = rows[index];
    const actual = records[index];
    if (Number(actual.source_index) !== expected.sourceIndex || actual.source_key !== expected.sourceKey ||
        actual.compatibility_code !== expected.compatibilityCode || actual.canonical_code !== expected.canonicalCode ||
        actual.display_name !== expected.name || actual.grade_display_name !== expected.gradeDisplayName || actual.emoji_value !== expected.emoji ||
        (expected.plusGradeCode !== null && actual.grade_code !== expected.plusGradeCode)) {
      throw new Error(`MINIPET_SHADOW_MISMATCH:${expected.sourceKey}`);
    }
  }
  const extras = (await connection.query("SELECT COUNT(*) total FROM mini_pet_definitions d LEFT JOIN mini_pet_definition_source_bindings b ON b.mini_pet_definition_id=d.id WHERE b.id IS NULL"))[0];
  const draw = (await connection.query("SELECT COUNT(*) total FROM dynamic_item_catalog_entries WHERE catalog_code='legacy-mini-pet'"))[0];
  const objects = (await connection.query("SELECT COUNT(*) total FROM object_registry WHERE object_type IN ('PET','MINI_PET') AND (object_key LIKE 'pet.minipet.%' OR JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.domain'))='mini_pet')"))[0];
  if (Number(extras.total) !== 28 || Number(draw.total) !== 1066 || Number(objects.total) !== 0) throw new Error("MINIPET_SHADOW_BOUNDARY");
  console.log(JSON.stringify({
    result: "passed",
    matched: records.length,
    source: rows.length,
    reused: 1078,
    created: 0,
    extraPreserved: Number(extras.total),
    drawEligible: Number(draw.total),
    elite: rows.filter((row) => row.elite).length,
    objectCatalogBindings: Number(objects.total),
    bindingStrategy: "MINI_PET_DEFINITION_SOURCE_BINDING"
  }));
} finally {
  await connection.end();
}
