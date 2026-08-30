import fs from "node:fs";
import mariadb from "mariadb";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pendant-object-catalog-link-v1.json", import.meta.url), "utf8"));
const config = {
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33399"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_pendant_object_catalog_link_probe"
};
let connection = await mariadb.createConnection(config);
const checks = [];
const evidence = {};

async function check(name, work) { await work(); checks.push(name); }

try {
  await check("exact object source totals", async () => {
    const totals = (await connection.query(`SELECT
      (SELECT COUNT(*) FROM item_definitions WHERE asset_type_code='PENDANT' AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.objectType'))='pendant') definitions,
      (SELECT COUNT(*) FROM object_registry WHERE object_type='ITEM' AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.catalogVersion'))=?) objects,
      (SELECT COUNT(*) FROM object_source_bindings WHERE object_type='ITEM' AND source_system=? AND source_table=? AND source_key LIKE 'ITEM-PENDANT-DRAW-%') bindings`,
      [fixture.catalogVersion, fixture.sourceSystem, fixture.sourceTable]))[0];
    evidence.totals = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Number(value)]));
    if (evidence.totals.definitions !== fixture.definitions || evidence.totals.objects !== fixture.objects || evidence.totals.bindings !== fixture.sourceBindings) throw new Error(`totals mismatch:${JSON.stringify(evidence.totals)}`);
  });

  await check("exact definition metadata parity", async () => {
    const rows = await connection.query(`SELECT definition_row.code,definition_row.display_name,object_row.object_key,object_row.display_name object_display,source_row.source_key,
      JSON_UNQUOTE(JSON_EXTRACT(definition_row.metadata_json,'$.objectType')) definition_object_type,
      JSON_UNQUOTE(JSON_EXTRACT(definition_row.metadata_json,'$.grade')) definition_grade,
      JSON_UNQUOTE(JSON_EXTRACT(definition_row.metadata_json,'$.charm')) definition_charm,
      JSON_UNQUOTE(JSON_EXTRACT(definition_row.metadata_json,'$.explore')) definition_explore,
      JSON_UNQUOTE(JSON_EXTRACT(definition_row.metadata_json,'$.rate')) definition_rate,
      JSON_UNQUOTE(JSON_EXTRACT(definition_row.metadata_json,'$.drawOrder')) definition_draw_order,
      JSON_UNQUOTE(JSON_EXTRACT(definition_row.metadata_json,'$.gradeOrder')) definition_grade_order,
      JSON_UNQUOTE(JSON_EXTRACT(definition_row.metadata_json,'$.notice')) definition_notice,
      JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.objectType')) object_object_type,
      JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.grade')) object_grade,
      JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.charm')) object_charm,
      JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.explore')) object_explore,
      JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.rate')) object_rate,
      JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.drawOrder')) object_draw_order,
      JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.gradeOrder')) object_grade_order,
      JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.notice')) object_notice
      FROM item_definitions definition_row
      JOIN object_registry object_row ON object_row.object_key=CONCAT('item.pendant.',LOWER(SUBSTRING(definition_row.code,LENGTH('ITEM-PENDANT-DRAW-')+1))) AND object_row.object_type='ITEM'
      JOIN object_source_bindings source_row ON source_row.object_id=object_row.id AND source_row.object_type='ITEM' AND source_row.source_system=? AND source_row.source_table=? AND source_row.source_key=definition_row.code
      WHERE definition_row.asset_type_code='PENDANT' AND JSON_UNQUOTE(JSON_EXTRACT(definition_row.metadata_json,'$.objectType'))='pendant'
      ORDER BY CAST(JSON_UNQUOTE(JSON_EXTRACT(definition_row.metadata_json,'$.drawOrder')) AS UNSIGNED)`, [fixture.sourceSystem, fixture.sourceTable]);
    if (rows.length !== fixture.rows.length) throw new Error(`parity count:${rows.length}`);
    rows.forEach((row, index) => {
      const expected = fixture.rows[index];
      const fields = ["object_type", "grade", "charm", "explore", "rate", "draw_order", "grade_order", "notice"];
      if (row.code !== expected.code || row.display_name !== expected.display || row.object_key !== expected.key || row.object_display !== expected.display || row.source_key !== expected.code) throw new Error(`identity mismatch:${expected.code}`);
      if (row.definition_object_type !== "pendant" || row.definition_grade !== expected.grade || row.definition_charm !== expected.charm || Number(row.definition_explore) !== expected.explore || Number(row.definition_rate) !== expected.rate || Number(row.definition_draw_order) !== expected.drawOrder || Number(row.definition_grade_order) !== expected.gradeOrder || (row.definition_notice === "true") !== expected.notice) throw new Error(`definition invariant mismatch:${expected.code}`);
      for (const field of fields) if (String(row[`definition_${field}`]) !== String(row[`object_${field}`])) throw new Error(`object invariant mismatch:${expected.code}:${field}`);
    });
  });

  await check("excluded boundaries remain untouched", async () => {
    const counts = (await connection.query(`SELECT
      (SELECT COUNT(*) FROM object_registry WHERE object_key='item.pendant.ticket') ticket_objects,
      (SELECT COUNT(*) FROM object_aliases alias_row JOIN object_registry object_row ON object_row.id=alias_row.object_id WHERE JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.catalogVersion'))=?) aliases,
      (SELECT COUNT(*) FROM pendant_draw_results) draw_results,
      (SELECT COUNT(*) FROM pendant_upgrade_confirmations) upgrade_confirmations,
      (SELECT COUNT(*) FROM inventory_instances) inventory_instances,
      (SELECT COUNT(*) FROM pendant_equip_confirmations) equip_confirmations,
      (SELECT COUNT(*) FROM market_pendant_registration_ledger) market_rows,
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='owned_pendants') owned_pendants_tables`, [fixture.catalogVersion]))[0];
    evidence.excluded = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)]));
    if (Object.values(evidence.excluded).some((value) => value !== 0)) throw new Error(`excluded boundary mismatch:${JSON.stringify(evidence.excluded)}`);
  });

  await check("transaction rollback", async () => {
    const before = (await connection.query("SELECT display_name FROM object_registry WHERE object_key='item.pendant.quiet'"))[0].display_name;
    await connection.beginTransaction();
    await connection.query("UPDATE object_registry SET display_name='ROLLBACK-PROBE' WHERE object_key='item.pendant.quiet'");
    await connection.rollback();
    const after = (await connection.query("SELECT display_name FROM object_registry WHERE object_key='item.pendant.quiet'"))[0].display_name;
    if (before !== after) throw new Error("transaction rollback mismatch");
  });

  await connection.end();
  connection = await mariadb.createConnection(config);
  const reconnect = (await connection.query("SELECT COUNT(*) total FROM object_registry WHERE object_type='ITEM' AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.catalogVersion'))=?", [fixture.catalogVersion]))[0];
  if (Number(reconnect.total) !== fixture.objects) throw new Error(`reconnect mismatch:${reconnect.total}`);
  checks.push("reconnect");
  console.log(JSON.stringify({ result: "passed", checks, total: checks.length, evidence }));
} finally { if (connection) await connection.end(); }
