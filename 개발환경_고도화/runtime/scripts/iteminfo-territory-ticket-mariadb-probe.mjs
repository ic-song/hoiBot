import assert from "node:assert/strict";
import fs from "node:fs";
import mariadb from "mariadb";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/iteminfo-territory-tickets-v1.json", import.meta.url), "utf8"));
const connection = await mariadb.createConnection({
  host: process.env.HOIBOT_DB_HOST || "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT || "3306"),
  user: process.env.HOIBOT_DB_USER || "root",
  password: process.env.HOIBOT_DB_PASSWORD || "",
  database: process.env.HOIBOT_DB_NAME
});

try {
  const rows = await connection.query("SELECT ticket.ticket_code,registry.object_key,item.code item_code,ticket.scope_code,ticket.source_item_key,ticket.display_name,ticket.display_rate_percent,CAST(ticket.success_rate AS CHAR) success_rate,ticket.display_order,ticket.source_hash,ticket.catalog_version FROM guild_territory_ticket_definitions ticket JOIN object_registry registry ON registry.id=ticket.object_id JOIN item_definitions item ON item.id=ticket.item_id WHERE ticket.active=TRUE ORDER BY ticket.display_order");
  const actual = rows.map((row) => ({
    ticketCode: row.ticket_code,
    objectKey: row.object_key,
    itemCode: row.item_code,
    scope: row.scope_code,
    sourceKey: row.source_item_key,
    sourceIdentity: `${row.scope_code}/${row.source_item_key}`,
    displayName: row.display_name,
    displayRatePercent: Number(row.display_rate_percent),
    successRate: Number(row.success_rate),
    displayOrder: Number(row.display_order),
    sourceHash: row.source_hash,
    sourceFileHash: fixture.sourceFileHash,
    catalogVersion: row.catalog_version,
    reusedCanonical: row.item_code === "ITEM-TERRITORY-DEFENSE-50"
  }));
  assert.deepEqual(actual, fixture.rows);
  const counts = (await connection.query("SELECT (SELECT COUNT(*) FROM guild_territory_ticket_definitions WHERE active=TRUE) definitions,(SELECT COUNT(*) FROM object_registry WHERE object_key LIKE 'item.guild-territory.ticket-%') objects,(SELECT COUNT(*) FROM object_source_bindings WHERE source_table='data/itemInfo.json#castlePremiumItem') bindings,(SELECT COUNT(*) FROM item_definitions WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.objectType'))='territory_ticket' AND active=TRUE) items"))[0];
  assert.deepEqual([Number(counts.definitions), Number(counts.objects), Number(counts.bindings), Number(counts.items)], [6, 6, 6, 6]);
  console.log(JSON.stringify({ result: "passed", checks: 8, definitions: 6, items: 6, objects: 6, bindings: 6, reused: "ITEM-TERRITORY-DEFENSE-50" }));
} finally {
  await connection.end();
}
