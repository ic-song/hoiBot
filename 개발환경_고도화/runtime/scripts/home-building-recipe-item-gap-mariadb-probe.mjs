import fs from "node:fs";
import mariadb from "mariadb";

const rows = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/home-building-recipe-item-crosswalk-v1.json", import.meta.url), "utf8"));
const connection = await mariadb.createConnection({
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33310"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_home_recipe_item_gap_probe"
});
const checks = [];

async function check(name, work) {
  await work();
  checks.push(name);
}

try {
  await check("definition parity", async () => {
    const records = await connection.query(
      `SELECT code,display_name,asset_type_code,stackable,active FROM item_definitions WHERE code IN (${rows.map(() => "?").join(",")})`,
      rows.map((row) => row.definitionCode)
    );
    if (records.length !== 4) throw new Error("definition count mismatch");
    const byCode = new Map(records.map((record) => [record.code, record]));
    for (const row of rows) {
      const record = byCode.get(row.definitionCode);
      if (!record || record.display_name !== row.legacyName || !record.stackable || !record.active) {
        throw new Error(`definition mismatch:${row.definitionCode}`);
      }
    }
    if (byCode.get("ITEM-RWD-041").asset_type_code !== "STACK") throw new Error("stone model mismatch");
    if (byCode.get("ITEM-RING-UPGRADE-STONE").asset_type_code !== "STACK") throw new Error("ring model mismatch");
  });

  await check("object and alias parity", async () => {
    const result = await connection.query(
      "SELECT COUNT(DISTINCT r.id) objects,COUNT(DISTINCT a.id) aliases FROM object_registry r " +
      "LEFT JOIN object_aliases a ON a.object_id=r.id AND a.object_type=r.object_type AND a.alias_type='legacy_name' " +
      "WHERE r.object_key IN (?,?,?,?)",
      rows.map((row) => row.objectKey)
    );
    if (Number(result[0].objects) !== 4 || Number(result[0].aliases) !== 4) throw new Error("object/alias mismatch");
  });

  await check("source binding parity", async () => {
    const result = await connection.query(
      "SELECT COUNT(*) total,SUM(source_system='RUNTIME_DB') runtime_count,SUM(source_system='LEGACY_JSON') json_count " +
      "FROM object_source_bindings s JOIN object_registry r ON r.id=s.object_id AND r.object_type=s.object_type " +
      "WHERE r.object_key IN (?,?,?,?)",
      rows.map((row) => row.objectKey)
    );
    if (Number(result[0].total) !== 18 || Number(result[0].runtime_count) !== 4 || Number(result[0].json_count) !== 14) {
      throw new Error("source binding mismatch");
    }
  });

  await check("sell policy parity", async () => {
    const result = await connection.query(
      `SELECT COUNT(*) total,SUM(p.sellable=FALSE) blocked FROM item_sale_policies p JOIN item_definitions d ON d.id=p.item_id WHERE d.code IN (${rows.map(() => "?").join(",")})`,
      rows.map((row) => row.definitionCode)
    );
    if (Number(result[0].total) !== 4 || Number(result[0].blocked) !== 4) throw new Error("sell policy mismatch");
  });

  await check("transaction rollback", async () => {
    const before = await connection.query("SELECT metadata_json FROM object_registry WHERE object_key='item.ring.upgrade_stone'");
    await connection.beginTransaction();
    await connection.query("UPDATE object_registry SET metadata_json=JSON_OBJECT('rollbackProbe',TRUE) WHERE object_key='item.ring.upgrade_stone'");
    await connection.rollback();
    const after = await connection.query("SELECT metadata_json FROM object_registry WHERE object_key='item.ring.upgrade_stone'");
    if (JSON.stringify(before[0].metadata_json) !== JSON.stringify(after[0].metadata_json)) throw new Error("transaction rollback mismatch");
  });

  await check("legacy conflict preservation", async () => {
    const definitions = await connection.query("SELECT code,active FROM item_definitions WHERE code IN ('ITEM-RWD-042','castle_coin') ORDER BY code");
    if (definitions.length !== 2 || definitions[0].code !== "ITEM-RWD-042" || definitions[1].code !== "castle_coin") {
      throw new Error("castle identity preservation mismatch");
    }
    const refs = await connection.query("SELECT COUNT(*) total FROM package_reward_rules WHERE item_id='ITEM-RWD-042'");
    if (Number(refs[0].total) === 0) throw new Error("legacy package references missing");
  });

  await check("legendary dependency isolation", async () => {
    const result = await connection.query(
      "SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.consumerCorrectionDependency')) dependency FROM object_registry WHERE object_key='item.material.legendary_stone'"
    );
    if (result.length !== 1 || result[0].dependency !== "inventory.open_all:legendary_stone->ITEM-RWD-052") {
      throw new Error("dependency metadata mismatch");
    }
    const drift = await connection.query("SELECT COUNT(*) total FROM item_definitions WHERE code='legendary_stone'");
    if (Number(drift[0].total) !== 0) throw new Error("forbidden legendary_stone definition created");
  });

  console.log(JSON.stringify({ result: "passed", checks, definitions: 4, objects: 4, aliases: 4, sources: 18, sellable: 0 }));
} finally {
  await connection.end();
}
