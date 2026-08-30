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

try {
  const records = await connection.query(
    "SELECT r.object_key,r.display_name,r.active,JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json,'$.definitionCode')) definition_code," +
    "JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json,'$.ownershipModel')) ownership_model,d.stackable,d.active definition_active,p.sellable " +
    "FROM object_registry r JOIN item_definitions d ON d.code=JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json,'$.definitionCode')) " +
    "JOIN item_sale_policies p ON p.item_id=d.id WHERE r.object_key IN (?,?,?,?)",
    rows.map((row) => row.objectKey)
  );
  const byObject = new Map(records.map((record) => [record.object_key, record]));
  for (const row of rows) {
    const record = byObject.get(row.objectKey);
    if (!record || record.display_name !== row.legacyName || record.definition_code !== row.definitionCode) {
      throw new Error(`HOME_RECIPE_IDENTITY_MISMATCH:${row.objectKey}`);
    }
    if (!record.active || !record.definition_active || !record.stackable || record.ownership_model !== "STACK" || record.sellable) {
      throw new Error(`HOME_RECIPE_POLICY_MISMATCH:${row.objectKey}`);
    }
  }
  console.log(JSON.stringify({ result: "passed", matched: records.length, source: rows.length, homeRecipeRows: 1151 }));
} finally {
  await connection.end();
}
