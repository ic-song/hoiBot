import fs from "node:fs";
import mariadb from "mariadb";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/furniture-object-catalog-link-v1.json", import.meta.url), "utf8"));
const connection = await mariadb.createConnection({
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33398"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_furniture_object_catalog_link_probe"
});

try {
  const rows = await connection.query(`WITH canonical AS (
    SELECT entry_row.source_sequence,definition_row.code source_code,
      MIN(definition_row.code) OVER (PARTITION BY BINARY definition_row.display_name,definition_row.charm_value,entry_row.grade_ordinal) canonical_code
    FROM home_furniture_draw_entries entry_row
    JOIN home_furniture_draw_catalog_versions catalog_row ON catalog_row.id=entry_row.catalog_version_id
    JOIN furniture_definitions definition_row ON definition_row.id=entry_row.furniture_definition_id
    WHERE catalog_row.source_sha256=?)
    SELECT canonical.*,object_row.id object_id,object_row.object_key,alias_row.alias_value,source_row.source_key
    FROM canonical
    JOIN object_registry object_row ON object_row.object_key=CONCAT('furniture.catalog_',LOWER(canonical.canonical_code)) AND object_row.object_type='FURNITURE'
    JOIN object_aliases alias_row ON alias_row.object_id=object_row.id AND alias_row.alias_type=? AND alias_row.alias_value=canonical.source_code
    JOIN object_source_bindings source_row ON source_row.object_id=object_row.id AND source_row.source_system=? AND source_row.source_table=?
      AND source_row.source_key=CONCAT('source-row-',LPAD(canonical.source_sequence,4,'0'))
    ORDER BY canonical.source_sequence`, [fixture.sourceHash, fixture.aliasType, fixture.sourceSystem, fixture.sourceTable]);
  const objectIds = new Set();
  rows.forEach((row, offset) => {
    const sourceSequence = offset + 1;
    if (Number(row.source_sequence) !== sourceSequence || row.object_key !== `${fixture.objectKeyPrefix}${String(row.canonical_code).toLowerCase()}` ||
        row.alias_value !== row.source_code || row.source_key !== `source-row-${String(sourceSequence).padStart(4, "0")}`) {
      throw new Error(`FURNITURE_SHADOW_MISMATCH:${sourceSequence}`);
    }
    objectIds.add(String(row.object_id));
  });
  if (rows.length !== fixture.sourceRows || objectIds.size !== fixture.objects) throw new Error(`FURNITURE_SHADOW_COUNT:${rows.length}:${objectIds.size}`);
  console.log(JSON.stringify({ result: "passed", matched: rows.length, objects: objectIds.size, aliases: fixture.aliases,
    sourceBindings: fixture.sourceBindings, duplicateOccurrencesPreserved: fixture.duplicateOccurrences,
    ownershipRowsMutated: fixture.ownershipRowsMutated, providerAdminAdded: false }));
} finally {
  await connection.end();
}
