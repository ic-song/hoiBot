import fs from "node:fs";
import mariadb from "mariadb";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/furniture-object-catalog-link-v1.json", import.meta.url), "utf8"));
const config = {
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33398"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_furniture_object_catalog_link_probe"
};
let connection = await mariadb.createConnection(config);
const checks = [];
const evidence = {};

async function check(name, work) {
  await work();
  checks.push(name);
}

try {
  await check("exact object alias source totals", async () => {
    const totals = (await connection.query(`SELECT
      (SELECT COUNT(*) FROM object_registry WHERE object_type='FURNITURE' AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.catalogVersion'))=?) objects,
      (SELECT COUNT(*) FROM object_aliases alias_row JOIN object_registry object_row ON object_row.id=alias_row.object_id WHERE object_row.object_type='FURNITURE' AND alias_row.alias_type=?) aliases,
      (SELECT COUNT(*) FROM object_source_bindings WHERE object_type='FURNITURE' AND source_system=? AND source_table=?) bindings`,
      [fixture.catalogVersion, fixture.aliasType, fixture.sourceSystem, fixture.sourceTable]))[0];
    evidence.totals = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Number(value)]));
    if (evidence.totals.objects !== fixture.objects || evidence.totals.aliases !== fixture.aliases || evidence.totals.bindings !== fixture.sourceBindings) {
      throw new Error(`catalog totals mismatch:${JSON.stringify(evidence.totals)}`);
    }
  });

  await check("exact source canonical parity", async () => {
    const rows = await connection.query(`WITH canonical AS (
      SELECT entry_row.source_sequence,definition_row.code source_code,definition_row.display_name,definition_row.charm_value,entry_row.grade_ordinal,
        MIN(definition_row.code) OVER (PARTITION BY BINARY definition_row.display_name,definition_row.charm_value,entry_row.grade_ordinal) canonical_code
      FROM home_furniture_draw_entries entry_row
      JOIN home_furniture_draw_catalog_versions catalog_row ON catalog_row.id=entry_row.catalog_version_id
      JOIN furniture_definitions definition_row ON definition_row.id=entry_row.furniture_definition_id
      WHERE catalog_row.source_sha256=?)
      SELECT canonical.*,object_row.id object_id,object_row.object_key,alias_row.alias_value,source_row.source_key
      FROM canonical
      JOIN object_registry object_row ON object_row.object_key=CONCAT('furniture.catalog_',LOWER(canonical.canonical_code)) AND object_row.object_type='FURNITURE'
      JOIN object_aliases alias_row ON alias_row.object_id=object_row.id AND alias_row.object_type='FURNITURE' AND alias_row.alias_type=? AND alias_row.alias_value=canonical.source_code
      JOIN object_source_bindings source_row ON source_row.object_id=object_row.id AND source_row.object_type='FURNITURE' AND source_row.source_system=? AND source_row.source_table=?
        AND source_row.source_key=CONCAT('source-row-',LPAD(canonical.source_sequence,4,'0'))
      ORDER BY canonical.source_sequence`, [fixture.sourceHash, fixture.aliasType, fixture.sourceSystem, fixture.sourceTable]);
    if (rows.length !== fixture.sourceRows) throw new Error(`source parity count:${rows.length}`);
    const objects = new Set();
    rows.forEach((row, offset) => {
      const sourceSequence = offset + 1;
      const expectedKey = `${fixture.objectKeyPrefix}${String(row.canonical_code).toLowerCase()}`;
      if (Number(row.source_sequence) !== sourceSequence || row.object_key !== expectedKey || row.alias_value !== row.source_code || row.source_key !== `source-row-${String(sourceSequence).padStart(4, "0")}`) {
        throw new Error(`source parity mismatch:${sourceSequence}`);
      }
      objects.add(String(row.object_id));
    });
    if (objects.size !== fixture.objects) throw new Error(`canonical object count:${objects.size}`);
  });

  await check("duplicates and display collisions preserved", async () => {
    const duplicate = (await connection.query(`SELECT COUNT(*) duplicate_groups,COALESCE(SUM(row_count-1),0) duplicate_occurrences
      FROM (SELECT definition_row.display_name,definition_row.charm_value,entry_row.grade_ordinal,COUNT(*) row_count
        FROM home_furniture_draw_entries entry_row
        JOIN home_furniture_draw_catalog_versions catalog_row ON catalog_row.id=entry_row.catalog_version_id
        JOIN furniture_definitions definition_row ON definition_row.id=entry_row.furniture_definition_id
        WHERE catalog_row.source_sha256=? GROUP BY BINARY definition_row.display_name,definition_row.charm_value,entry_row.grade_ordinal HAVING COUNT(*)>1) duplicate_rows`, [fixture.sourceHash]))[0];
    const collision = (await connection.query(`SELECT COUNT(*) collision_groups FROM (
      SELECT definition_row.display_name
      FROM home_furniture_draw_entries entry_row
      JOIN home_furniture_draw_catalog_versions catalog_row ON catalog_row.id=entry_row.catalog_version_id
      JOIN furniture_definitions definition_row ON definition_row.id=entry_row.furniture_definition_id
      WHERE catalog_row.source_sha256=? GROUP BY BINARY definition_row.display_name
      HAVING COUNT(DISTINCT CONCAT(definition_row.charm_value,'|',entry_row.grade_ordinal))>1) collision_rows`, [fixture.sourceHash]))[0];
    evidence.duplicates = { groups: Number(duplicate.duplicate_groups), occurrences: Number(duplicate.duplicate_occurrences), displayOnlyCollisionGroups: Number(collision.collision_groups) };
    if (evidence.duplicates.groups !== fixture.duplicateGroups || evidence.duplicates.occurrences !== fixture.duplicateOccurrences || evidence.duplicates.displayOnlyCollisionGroups !== fixture.displayOnlyCollisionGroups) {
      throw new Error(`duplicate boundary mismatch:${JSON.stringify(evidence.duplicates)}`);
    }
  });

  await check("draw definitions and ownership boundaries preserved", async () => {
    const counts = (await connection.query(`SELECT
      (SELECT COUNT(*) FROM furniture_definitions WHERE code LIKE 'HOME-DRAW-%') definitions,
      (SELECT COUNT(*) FROM home_furniture_draw_entries) draw_rows,
      (SELECT COALESCE(SUM(entry_count),0) FROM home_furniture_draw_grade_bands) draw_weight_rows,
      (SELECT COUNT(*) FROM furniture_inventory_instances) inventory_instances,
      (SELECT COUNT(*) FROM furniture_inventory_ledger) inventory_ledger,
      (SELECT COUNT(*) FROM owned_furniture) owned_furniture,
      (SELECT COUNT(*) FROM furniture_placements) placements,
      (SELECT COUNT(*) FROM market_furniture_registration_items) market_items`))[0];
    evidence.preserved = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)]));
    if (evidence.preserved.definitions !== fixture.physicalDefinitions || evidence.preserved.draw_rows !== fixture.sourceRows || evidence.preserved.draw_weight_rows !== fixture.sourceRows ||
        evidence.preserved.inventory_instances !== 0 || evidence.preserved.inventory_ledger !== 0 || evidence.preserved.owned_furniture !== 0 || evidence.preserved.placements !== 0 || evidence.preserved.market_items !== 0) {
      throw new Error(`protected boundary mismatch:${JSON.stringify(evidence.preserved)}`);
    }
  });

  await check("transaction rollback", async () => {
    const key = `${fixture.objectKeyPrefix}home-draw-0001`;
    const before = (await connection.query("SELECT display_name FROM object_registry WHERE object_key=?", [key]))[0].display_name;
    await connection.beginTransaction();
    await connection.query("UPDATE object_registry SET display_name='ROLLBACK-PROBE' WHERE object_key=?", [key]);
    await connection.rollback();
    const after = (await connection.query("SELECT display_name FROM object_registry WHERE object_key=?", [key]))[0].display_name;
    if (before !== after) throw new Error("transaction rollback mismatch");
  });

  await connection.end();
  connection = await mariadb.createConnection(config);
  const reconnect = (await connection.query("SELECT COUNT(*) total FROM object_registry WHERE object_type='FURNITURE' AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.catalogVersion'))=?", [fixture.catalogVersion]))[0];
  if (Number(reconnect.total) !== fixture.objects) throw new Error(`reconnect mismatch:${reconnect.total}`);
  checks.push("reconnect");
  console.log(JSON.stringify({ result: "passed", checks, total: checks.length, evidence }));
} finally {
  if (connection) await connection.end();
}
