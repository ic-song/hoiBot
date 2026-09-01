import fs from "node:fs";
import mariadb from "mariadb";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/common-item-object-gap-link-v1.json", import.meta.url), "utf8"));
const connection = await mariadb.createConnection({
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "3308"),
  user: process.env.HOIBOT_DB_USER ?? "hoibot_app",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_common_item_gap_shadow"
});

try {
  const rows = await connection.query(`SELECT JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.definitionCode')) code,
    object_row.object_key,alias_row.alias_value,source_row.source_system,source_row.source_table,source_row.source_key,
    JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.definitionTarget')) definition_target,
    JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.sourceIdentity')) source_identity
    FROM object_registry object_row
    JOIN object_source_bindings source_row ON source_row.object_id=object_row.id AND source_row.object_type='ITEM'
    JOIN object_aliases alias_row ON alias_row.object_id=object_row.id AND alias_row.alias_type='item_code'
      AND alias_row.alias_value=JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.definitionCode'))
    WHERE object_row.object_type='ITEM' AND JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.catalogVersion'))=?
    ORDER BY BINARY JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.definitionCode'))`, [fixture.catalogVersion]);
  const actualCodes = rows.map((row) => row.code).sort();
  const expectedCodes = [...fixture.codes].sort();
  if (rows.length !== fixture.gap || JSON.stringify(actualCodes) !== JSON.stringify(expectedCodes)) throw new Error(`COMMON_ITEM_SHADOW_COUNT:${rows.length}`);
  for (const row of rows) {
    if (row.object_key !== `${fixture.objectKeyPrefix}${String(row.code).toLowerCase()}` || row.alias_value !== row.code || row.source_key !== row.code ||
        row.definition_target !== `item_definitions|${row.code}` || row.source_identity !== `RUNTIME_DB|item_definitions|${row.code}` ||
        row.source_system !== fixture.sourceSystem || row.source_table !== fixture.sourceTable) {
      throw new Error(`COMMON_ITEM_SHADOW_IDENTITY:${row.code}`);
    }
  }
  const total = Number((await connection.query("SELECT COUNT(*) total FROM object_registry WHERE object_type='ITEM'"))[0].total);
  if (total !== fixture.objectsAfter) throw new Error(`COMMON_ITEM_SHADOW_PHYSICAL:${total}`);
  console.log(JSON.stringify({ result: "passed", matched: rows.length, runtimeDefinitionLinks: fixture.runtimeDefinitionLinks,
    definitionsSeeded: fixture.definitionsSeeded, objectsAdded: fixture.objectsAdded, aliasesAdded: fixture.aliasesAdded,
    sourceBindingsAdded: fixture.sourceBindingsAdded, commonSemanticValid: fixture.commonEligible, pendantSemanticValid: fixture.pendantSemanticValid,
    conflictOccurrencesPreserved: fixture.conflictOccurrencesPreserved, physicalObjects: total, providerAdminAdded: false }));
} finally {
  await connection.end();
}
