import fs from "node:fs";
import mariadb from "mariadb";

const rows = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/direct-bag-stack-crosswalk-v1.json", import.meta.url), "utf8"));
const connection = await mariadb.createConnection({
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33310"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_direct_bag_stack_probe"
});
const checks = [];

async function check(name, work) {
  await work();
  checks.push(name);
}

try {
  await check("new definition parity", async () => {
    const created = rows.filter((row) => !row.reusedExisting);
    const codes = created.map((row) => row.definitionCode);
    const records = await connection.query(
      `SELECT code,display_name,asset_type_code,stackable,active FROM item_definitions WHERE code IN (${codes.map(() => "?").join(",")})`,
      codes
    );
    if (records.length !== 116) throw new Error("new definition count mismatch");
    const byCode = new Map(records.map((record) => [record.code, record]));
    for (const row of created) {
      const record = byCode.get(row.definitionCode);
      if (!record || record.display_name !== row.legacyName || record.asset_type_code !== "STACK" || !record.stackable || !record.active) {
        throw new Error(`new definition mismatch:${row.definitionCode}`);
      }
    }
  });

  await check("reused definition state", async () => {
    const reused = rows.filter((row) => row.reusedExisting);
    const codes = reused.map((row) => row.definitionCode);
    const records = await connection.query(
      `SELECT code,display_name,stackable,active FROM item_definitions WHERE code IN (${codes.map(() => "?").join(",")})`,
      codes
    );
    if (records.length !== 66) throw new Error("reused definition count mismatch");
    const byCode = new Map(records.map((record) => [record.code, record]));
    for (const row of reused) {
      const record = byCode.get(row.definitionCode);
      if (!record || record.display_name !== row.definitionDisplayName || Boolean(record.active) !== row.definitionActive || !record.stackable) {
        throw new Error(`reused definition drift:${row.definitionCode}`);
      }
    }
  });

  await check("object catalog parity", async () => {
    const result = await connection.query(
      "SELECT COUNT(*) total,SUM(r.active=TRUE) active,SUM(r.active=FALSE) inactive," +
      "COUNT(DISTINCT a.alias_value) aliases,COUNT(DISTINCT s.source_key) sources " +
      "FROM object_registry r " +
      "JOIN object_aliases a ON a.object_id=r.id AND a.object_type=r.object_type AND a.alias_type='legacy_name' " +
      "JOIN object_source_bindings s ON s.object_id=r.id AND s.object_type=r.object_type " +
      "AND s.source_system='LEGACY_JS' AND s.source_table='member.bag' " +
      "WHERE r.object_type='ITEM' AND r.object_key LIKE 'item.direct\\_bag.%' ESCAPE '\\\\'"
    );
    const row = result[0];
    if (Number(row.total) !== 182 || Number(row.active) !== 148 || Number(row.inactive) !== 34 || Number(row.aliases) !== 182 || Number(row.sources) !== 182) {
      throw new Error("object catalog count mismatch");
    }
  });

  await check("definition link parity", async () => {
    const result = await connection.query(
      "SELECT COUNT(*) total FROM object_registry r JOIN item_definitions d " +
      "ON d.code=JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json,'$.definitionCode')) " +
      "WHERE r.object_type='ITEM' AND r.object_key LIKE 'item.direct\\_bag.%' ESCAPE '\\\\'"
    );
    if (Number(result[0].total) !== 182) throw new Error("definition link mismatch");
  });

  await check("legacy display/source parity", async () => {
    const records = await connection.query(
      "SELECT r.object_key,r.display_name,JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json,'$.definitionCode')) definition_code," +
      "s.source_key FROM object_registry r JOIN object_source_bindings s ON s.object_id=r.id AND s.object_type=r.object_type " +
      "WHERE r.object_type='ITEM' AND r.object_key LIKE 'item.direct\\_bag.%' ESCAPE '\\\\'"
    );
    const byObject = new Map(records.map((record) => [record.object_key, record]));
    for (const row of rows) {
      const record = byObject.get(row.objectKey);
      if (!record || record.display_name !== row.legacyName || record.source_key !== row.legacyName || record.definition_code !== row.definitionCode) {
        throw new Error(`legacy source mismatch:${row.objectKey}`);
      }
    }
  });

  console.log(JSON.stringify({ result: "passed", checks, total: checks.length }));
} finally {
  await connection.end();
}
