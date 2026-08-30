import fs from "node:fs";
import mariadb from "mariadb";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/common-item-object-gap-link-v1.json", import.meta.url), "utf8"));
const itemSnapshot = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/item-definition-snapshot-v1.json", import.meta.url), "utf8"));
const config = {
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "3308"),
  user: process.env.HOIBOT_DB_USER ?? "hoibot_app",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_common_item_gap_probe"
};
let connection = await mariadb.createConnection(config);
const checks = [];
const evidence = {};

async function check(name, work) {
  await work();
  checks.push(name);
}

async function loadParityRows() {
  return connection.query(`SELECT JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.definitionCode')) code,
    definition_row.code definition_row_code,definition_row.stackable,definition_row.version,
    object_row.object_key,object_row.version object_version,
    JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.definitionTarget')) definition_target,
    JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.ownershipModel')) ownership_model,
    JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.sourceIdentity')) source_identity,
    alias_row.alias_value,source_row.source_system,source_row.source_table,source_row.source_key
    FROM object_registry object_row
    LEFT JOIN item_definitions definition_row ON definition_row.code=JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.definitionCode'))
    JOIN object_source_bindings source_row ON source_row.object_id=object_row.id AND source_row.object_type='ITEM'
    JOIN object_aliases alias_row ON alias_row.object_id=object_row.id AND alias_row.object_type='ITEM'
      AND alias_row.alias_type='item_code' AND alias_row.alias_value=JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.definitionCode'))
    WHERE object_row.object_type='ITEM' AND JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.catalogVersion'))=?
    ORDER BY BINARY JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.definitionCode'))`, [fixture.catalogVersion]);
}

try {
  await check("exact 54 definition object alias binding parity", async () => {
    const rows = await loadParityRows();
    if (rows.length !== fixture.gap) throw new Error(`gap parity count:${rows.length}`);
    const actualCodes = rows.map((row) => row.code).sort();
    const expectedCodes = [...fixture.codes].sort();
    if (JSON.stringify(actualCodes) !== JSON.stringify(expectedCodes)) throw new Error("gap code parity mismatch");
    for (const row of rows) {
      const expectedKey = `${fixture.objectKeyPrefix}${String(row.code).toLowerCase()}`;
      const expectedOwnership = Number(row.stackable) === 1 ? "STACK" : "INSTANCE";
      if (row.object_key !== expectedKey || Number(row.object_version) !== Number(row.version) ||
          row.definition_target !== `item_definitions|${row.code}` || row.ownership_model !== expectedOwnership ||
          row.source_identity !== `RUNTIME_DB|item_definitions|${row.code}` || row.source_system !== fixture.sourceSystem ||
          row.source_table !== fixture.sourceTable || row.alias_value !== row.code || row.source_key !== row.code || row.definition_row_code !== row.code) {
        throw new Error(`identity mismatch:${row.code}`);
      }
    }
    evidence.parity = { runtimeDefinitions: fixture.runtimeDefinitionLinks, definitionsSeeded: fixture.definitionsSeeded,
      objects: rows.length, aliases: rows.length, sourceBindings: rows.length };
  });

  await check("physical and semantic totals", async () => {
    const totals = (await connection.query(`SELECT
      (SELECT COUNT(*) FROM object_registry WHERE object_type='ITEM') physical_objects,
      (SELECT COUNT(*) FROM object_registry WHERE object_type='ITEM' AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.catalogVersion'))=?) added_objects,
      (SELECT COUNT(*) FROM package_item_definitions) package_item_rows,
      (SELECT COUNT(*) FROM object_registry WHERE object_type='ITEM' AND object_key LIKE 'item.pendant.%') pendant_objects`, [fixture.catalogVersion]))[0];
    evidence.totals = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Number(value)]));
    const packageCodes = itemSnapshot.rows.filter((row) => row.boundary === "PACKAGE_COMPATIBILITY").map((row) => row.code);
    evidence.totals.packageMembership = packageCodes.length;
    evidence.totals.packageGapOverlap = fixture.codes.filter((code) => packageCodes.includes(code)).length;
    evidence.totals.semanticValid = fixture.commonEligible + fixture.pendantSemanticValid;
    evidence.totals.conflictOccurrences = evidence.totals.physical_objects - evidence.totals.semanticValid;
    if (evidence.totals.physical_objects !== fixture.objectsAfter || evidence.totals.added_objects !== fixture.objectsAdded ||
        evidence.totals.packageMembership !== fixture.packageDefinitionsPreserved || evidence.totals.packageGapOverlap !== 0 ||
        evidence.totals.pendant_objects !== fixture.pendantSemanticValid ||
        evidence.totals.semanticValid !== fixture.semanticValidAfter || evidence.totals.conflictOccurrences !== fixture.conflictOccurrencesPreserved) {
      throw new Error(`boundary totals mismatch:${JSON.stringify(evidence.totals)}`);
    }
  });

  await check("conditional direct-select definition gap closure", async () => {
    const placeholders = fixture.seededDefinitionCodes.map(() => "?").join(",");
    const rows = await connection.query(`SELECT code,display_name,asset_type_code,stackable,active,version,
      JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.source')) source,
      JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.seedKind')) seed_kind,
      JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.inclusionReason')) inclusion_reason,
      JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.seededByMigration')) seeded_by
      FROM item_definitions WHERE code IN (${placeholders}) ORDER BY BINARY code`, fixture.seededDefinitionCodes);
    if (rows.length !== fixture.definitionsSeeded || rows.some((row) => row.asset_type_code !== "ITEM" || Number(row.stackable) !== 1 ||
        Number(row.active) !== 1 || Number(row.version) !== 1 || row.source !== "212_admin_legacy_data_cleanup.sql" || row.seed_kind !== "DIRECT_SELECT" ||
        row.inclusion_reason !== "CONDITIONAL_DIRECT_SELECT_SEED_PREVIOUSLY_OMITTED" || row.seeded_by !== "401_common_item_object_gap_link.sql")) {
      throw new Error(`definition gap closure mismatch:${JSON.stringify(rows)}`);
    }
    evidence.definitionGapClosure = rows.map((row) => row.code);
  });

  await check("transaction rollback", async () => {
    const key = `${fixture.objectKeyPrefix}${fixture.codes[0].toLowerCase()}`;
    const before = (await connection.query("SELECT display_name FROM object_registry WHERE object_key=?", [key]))[0].display_name;
    await connection.beginTransaction();
    await connection.query("UPDATE object_registry SET display_name='ROLLBACK-PROBE' WHERE object_key=?", [key]);
    await connection.rollback();
    const after = (await connection.query("SELECT display_name FROM object_registry WHERE object_key=?", [key]))[0].display_name;
    if (before !== after) throw new Error("transaction rollback mismatch");
  });

  await connection.end();
  connection = await mariadb.createConnection(config);
  const reconnectRows = await loadParityRows();
  if (reconnectRows.length !== fixture.gap) throw new Error(`reconnect mismatch:${reconnectRows.length}`);
  checks.push("reconnect");
  console.log(JSON.stringify({ result: "passed", checks, total: checks.length, evidence }));
} finally {
  if (connection) await connection.end();
}
