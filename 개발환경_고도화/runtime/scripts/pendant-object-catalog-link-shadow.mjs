import fs from "node:fs";
import mariadb from "mariadb";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pendant-object-catalog-link-v1.json", import.meta.url), "utf8"));
const connection = await mariadb.createConnection({
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33399"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_pendant_object_catalog_link_probe"
});

try {
  const rows = await connection.query(`SELECT definition_row.code,definition_row.display_name,definition_row.metadata_json definition_metadata,
    object_row.object_key,object_row.display_name object_display,object_row.metadata_json object_metadata,source_row.source_key
    FROM item_definitions definition_row
    JOIN object_registry object_row ON object_row.object_key=CONCAT('item.pendant.',LOWER(SUBSTRING(definition_row.code,LENGTH('ITEM-PENDANT-DRAW-')+1))) AND object_row.object_type='ITEM'
    JOIN object_source_bindings source_row ON source_row.object_id=object_row.id AND source_row.object_type='ITEM' AND source_row.source_system=? AND source_row.source_table=? AND source_row.source_key=definition_row.code
    WHERE definition_row.asset_type_code='PENDANT' AND JSON_UNQUOTE(JSON_EXTRACT(definition_row.metadata_json,'$.objectType'))='pendant'
    ORDER BY CAST(JSON_UNQUOTE(JSON_EXTRACT(definition_row.metadata_json,'$.drawOrder')) AS UNSIGNED)`, [fixture.sourceSystem, fixture.sourceTable]);
  rows.forEach((row, index) => {
    const expected = fixture.rows[index];
    const definitionMetadata = typeof row.definition_metadata === "string" ? JSON.parse(row.definition_metadata) : row.definition_metadata;
    const objectMetadata = typeof row.object_metadata === "string" ? JSON.parse(row.object_metadata) : row.object_metadata;
    if (row.code !== expected.code || row.object_key !== expected.key || row.display_name !== expected.display || row.object_display !== expected.display || row.source_key !== expected.code) throw new Error(`PENDANT_SHADOW_IDENTITY:${index + 1}`);
    for (const field of ["objectType", "grade", "charm", "explore", "rate", "drawOrder", "gradeOrder", "notice"]) if (JSON.stringify(definitionMetadata[field]) !== JSON.stringify(objectMetadata[field])) throw new Error(`PENDANT_SHADOW_METADATA:${expected.code}:${field}`);
  });
  if (rows.length !== fixture.definitions) throw new Error(`PENDANT_SHADOW_COUNT:${rows.length}`);
  console.log(JSON.stringify({ result: "passed", matched: rows.length, objects: fixture.objects, sourceBindings: fixture.sourceBindings,
    aliases: fixture.aliases, metadataInvariants: 8, ownershipRowsMutated: fixture.ownershipRowsMutated, providerAdminAdded: false }));
} finally { await connection.end(); }
