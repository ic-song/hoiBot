import fs from "node:fs";
import mariadb from "mariadb";

const rows = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/home-building-definition-crosswalk-v1.json", import.meta.url), "utf8"));
const config = {
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33395"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_home_building_definition_probe"
};
let connection = await mariadb.createConnection(config);
const checks = [];
const evidence = {};

async function check(name, work) {
  await work();
  checks.push(name);
}

try {
  await check("definition progression binding totals", async () => {
    const totals = (await connection.query(`SELECT
      (SELECT COUNT(*) FROM object_registry WHERE object_type='HOME_BUILDING' AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.catalogVersion'))='ASSET-FREEZE-v2.400-home-building-01') definitions,
      (SELECT COUNT(*) FROM home_building_progression WHERE catalog_version='ASSET-FREEZE-v2.400-home-building-01') progression,
      (SELECT COUNT(*) FROM object_source_bindings WHERE object_type='HOME_BUILDING' AND source_system='LEGACY_JSON' AND source_table='petSweetHomeInfo.homeInfo') bindings`))[0];
    if (Number(totals.definitions) !== 299 || Number(totals.progression) !== 300 || Number(totals.bindings) !== 300) throw new Error(`catalog totals mismatch:${JSON.stringify(totals)}`);
    evidence.totals = { definitions: 299, progression: 300, bindings: 300 };
  });

  await check("source row exact parity", async () => {
    const actualRows = await connection.query(`SELECT progression.source_index,object_row.object_key,progression.floor_value,
      progression.experience_required,progression.recipe_json,progression.source_row_hash,binding_row.source_key
      FROM home_building_progression progression
      JOIN object_registry object_row ON object_row.id=progression.home_building_object_id
      JOIN object_source_bindings binding_row ON binding_row.object_id=object_row.id
        AND binding_row.source_system='LEGACY_JSON' AND binding_row.source_table='petSweetHomeInfo.homeInfo'
        AND binding_row.source_key=CONCAT('source-row-',LPAD(progression.source_index,4,'0'))
      ORDER BY progression.source_index`);
    if (actualRows.length !== rows.length) throw new Error(`source parity count:${actualRows.length}`);
    rows.forEach((expected, index) => {
      const actual = actualRows[index];
      const recipe = typeof actual.recipe_json === "string" ? JSON.parse(actual.recipe_json) : actual.recipe_json;
      if (Number(actual.source_index) !== expected.sourceIndex || actual.object_key !== expected.objectKey ||
          Number(actual.floor_value) !== expected.floor || Number(actual.experience_required) !== expected.exp ||
          actual.source_row_hash !== expected.sourceRowHash || actual.source_key !== expected.sourceKey ||
          JSON.stringify(recipe) !== JSON.stringify(expected.required)) throw new Error(`source parity mismatch:${expected.sourceKey}`);
    });
  });

  await check("floor duplicate policy", async () => {
    const floor190 = (await connection.query("SELECT COUNT(*) rows_count,COUNT(DISTINCT home_building_object_id) definitions FROM home_building_progression WHERE floor_value=190"))[0];
    const floor263 = (await connection.query("SELECT COUNT(*) rows_count,COUNT(DISTINCT home_building_object_id) definitions FROM home_building_progression WHERE floor_value=263"))[0];
    if (Number(floor190.rows_count) !== 2 || Number(floor190.definitions) !== 2 || Number(floor263.rows_count) !== 2 || Number(floor263.definitions) !== 1) throw new Error("floor duplicate policy mismatch");
    evidence.floor190 = "2 rows / 2 definitions";
    evidence.floor263 = "2 rows / 1 definition";
  });

  await check("recipe item migration carry forward", async () => {
    const items = await connection.query("SELECT code FROM item_definitions WHERE code IN ('ITEM-RWD-041','ITEM-RING-UPGRADE-STONE','castle_coin','ITEM-RWD-052') AND active=TRUE ORDER BY code");
    if (items.length !== 4) throw new Error(`recipe item carry-forward mismatch:${items.length}`);
    const createdBy395 = (await connection.query("SELECT COUNT(*) total FROM item_definitions WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.homeBuildingDefinitionCatalogVersion'))='ASSET-FREEZE-v2.400-home-building-01'"))[0];
    if (Number(createdBy395.total) !== 0) throw new Error("migration395 created recipe item definitions");
  });

  await check("protected consumer snapshot", async () => {
    const counts = (await connection.query(`SELECT
      (SELECT COUNT(*) FROM player_homes) player_homes,
      (SELECT COUNT(*) FROM owned_furniture) owned_furniture,
      (SELECT COUNT(*) FROM furniture_inventory_instances) furniture_inventory_instances,
      (SELECT COUNT(*) FROM furniture_placements) furniture_placements,
      (SELECT COUNT(*) FROM inventory_stacks) inventory,
      (SELECT COUNT(*) FROM inventory_ledger) inventory_ledger,
      (SELECT COUNT(*) FROM currency_ledger) currency_ledger`))[0];
    evidence.protectedCounts = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)]));
  });

  await check("transaction rollback", async () => {
    const before = (await connection.query("SELECT catalog_version FROM home_building_progression WHERE source_index=1"))[0].catalog_version;
    await connection.beginTransaction();
    await connection.query("UPDATE home_building_progression SET catalog_version='ROLLBACK-PROBE' WHERE source_index=1");
    await connection.rollback();
    const after = (await connection.query("SELECT catalog_version FROM home_building_progression WHERE source_index=1"))[0].catalog_version;
    if (before !== after) throw new Error("transaction rollback mismatch");
  });

  await connection.end();
  connection = await mariadb.createConnection(config);
  const reconnect = (await connection.query("SELECT COUNT(*) total FROM home_building_progression"))[0];
  if (Number(reconnect.total) !== 300) throw new Error("reconnect mismatch");
  checks.push("reconnect");
  console.log(JSON.stringify({ result: "passed", checks, total: checks.length, evidence }));
} finally {
  if (connection) await connection.end();
}
