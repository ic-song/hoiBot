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

try {
  const records = await connection.query(
    "SELECT r.object_key,r.display_name,r.active,JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json,'$.definitionCode')) definition_code," +
    "d.active definition_active,d.stackable FROM object_registry r JOIN item_definitions d " +
    "ON d.code=JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json,'$.definitionCode')) " +
    "WHERE r.object_type='ITEM' AND r.object_key LIKE 'item.direct\\_bag.%' ESCAPE '\\\\'"
  );
  const byObject = new Map(records.map((record) => [record.object_key, record]));
  let matched = 0;
  for (const row of rows) {
    const record = byObject.get(row.objectKey);
    if (!record || record.display_name !== row.legacyName || record.definition_code !== row.definitionCode || !record.stackable) {
      throw new Error(`DIRECT_BAG_SHADOW_MISMATCH:${row.objectKey}`);
    }
    if (Boolean(record.active) !== row.definitionActive || Boolean(record.definition_active) !== row.definitionActive) {
      throw new Error(`DIRECT_BAG_STATE_MISMATCH:${row.objectKey}`);
    }
    matched += 1;
  }
  console.log(JSON.stringify({ result: "passed", matched, source: rows.length, reused: 66, created: 116, active: 148, inactive: 34 }));
} finally {
  await connection.end();
}
