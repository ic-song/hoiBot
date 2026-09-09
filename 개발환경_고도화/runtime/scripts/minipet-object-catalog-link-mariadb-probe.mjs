import fs from "node:fs";
import mariadb from "mariadb";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/minipet-object-catalog-link-v1.json", import.meta.url), "utf8"));
const config = {
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33397"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_minipet_object_catalog_link_probe"
};
let connection = await mariadb.createConnection(config);
const checks = [];
const evidence = {};

async function check(name, work) {
  await work();
  checks.push(name);
}

try {
  await check("object alias source binding totals", async () => {
    const totals = (await connection.query(`SELECT
      (SELECT COUNT(*) FROM object_registry WHERE object_type='MINI_PET' AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.catalogVersion'))=?) objects,
      (SELECT COUNT(*) FROM object_aliases WHERE object_type='MINI_PET' AND alias_type='legacy_code') aliases,
      (SELECT COUNT(*) FROM object_source_bindings WHERE object_type='MINI_PET' AND source_system=? AND source_table=?) bindings`,
      [fixture.catalogVersion, fixture.sourceSystem, fixture.sourceTable]))[0];
    if (Number(totals.objects) !== fixture.objects || Number(totals.aliases) !== fixture.aliases || Number(totals.bindings) !== fixture.sourceBindings) {
      throw new Error(`catalog totals mismatch:${JSON.stringify(totals)}`);
    }
    evidence.totals = { objects: Number(totals.objects), aliases: Number(totals.aliases), bindings: Number(totals.bindings) };
  });

  await check("exact canonical source parity", async () => {
    const rows = await connection.query(`SELECT canonical.source_index,canonical.source_key,canonical.compatibility_code,canonical.source_hash,
      definition_row.code definition_code,object_row.object_key,
      JSON_UNQUOTE(JSON_EXTRACT(object_row.metadata_json,'$.definitionCode')) metadata_definition_code,
      alias_row.alias_value,source_row.source_system,source_row.source_table,source_row.source_key linked_source_key
      FROM mini_pet_definition_source_bindings canonical
      JOIN mini_pet_definitions definition_row ON definition_row.id=canonical.mini_pet_definition_id
      JOIN object_registry object_row ON object_row.object_key=CONCAT('mini_pet.catalog_',LPAD(canonical.source_index,4,'0')) AND object_row.object_type='MINI_PET'
      JOIN object_aliases alias_row ON alias_row.object_id=object_row.id AND alias_row.object_type='MINI_PET' AND alias_row.alias_type='legacy_code'
      JOIN object_source_bindings source_row ON source_row.object_id=object_row.id AND source_row.object_type='MINI_PET'
        AND source_row.source_system=canonical.source_system AND source_row.source_table=canonical.source_table AND source_row.source_key=canonical.source_key
      WHERE canonical.source_system=? AND canonical.source_table=? AND canonical.catalog_version=?
      ORDER BY canonical.source_index`, [fixture.sourceSystem, fixture.sourceTable, fixture.sourceCatalogVersion]);
    if (rows.length !== fixture.sourceRows) throw new Error(`source parity count:${rows.length}`);
    rows.forEach((row, offset) => {
      const sourceIndex = offset + 1;
      if (Number(row.source_index) !== sourceIndex || row.object_key !== `${fixture.objectKeyPrefix}${String(sourceIndex).padStart(4, "0")}` ||
          row.definition_code !== row.metadata_definition_code || row.alias_value !== row.compatibility_code ||
          row.source_system !== fixture.sourceSystem || row.source_table !== fixture.sourceTable || row.linked_source_key !== row.source_key || row.source_hash !== fixture.sourceHash) {
        throw new Error(`source parity mismatch:${sourceIndex}`);
      }
    });
  });

  await check("composite collisions remain separate", async () => {
    const collision = (await connection.query(`SELECT COUNT(*) collision_groups,COALESCE(SUM(row_count-1),0) collision_surplus
      FROM (SELECT definition_row.display_name,definition_row.grade_display_name,COUNT(*) row_count
        FROM mini_pet_definition_source_bindings binding_row
        JOIN mini_pet_definitions definition_row ON definition_row.id=binding_row.mini_pet_definition_id
        WHERE binding_row.catalog_version=?
        GROUP BY definition_row.display_name,definition_row.grade_display_name HAVING COUNT(*)>1) collision_rows`, [fixture.sourceCatalogVersion]))[0];
    const distinctObjects = (await connection.query("SELECT COUNT(DISTINCT object_key) total FROM object_registry WHERE object_type='MINI_PET' AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.catalogVersion'))=?", [fixture.catalogVersion]))[0];
    if (Number(collision.collision_groups) !== fixture.collisionGroups || Number(collision.collision_surplus) !== fixture.collisionSurplus || Number(distinctObjects.total) !== fixture.objects) {
      throw new Error(`collision identity mismatch:${JSON.stringify(collision)}:${distinctObjects.total}`);
    }
    evidence.collisions = { groups: Number(collision.collision_groups), surplus: Number(collision.collision_surplus) };
  });

  await check("definition draw elite and protected consumers preserved", async () => {
    const counts = (await connection.query(`SELECT
      (SELECT COUNT(*) FROM mini_pet_definitions) definitions,
      (SELECT COUNT(*) FROM mini_pet_definitions definition_row LEFT JOIN mini_pet_definition_source_bindings binding_row ON binding_row.mini_pet_definition_id=definition_row.id WHERE binding_row.id IS NULL) extras,
      (SELECT COUNT(*) FROM dynamic_item_catalog_entries WHERE catalog_code='legacy-mini-pet') draw_rows,
      (SELECT COUNT(*) FROM object_registry WHERE object_type='MINI_PET' AND CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.sourceIndex')) AS UNSIGNED)>1066) elite_objects,
      (SELECT COUNT(*) FROM owned_mini_pets) owned_mini_pets,
      (SELECT COUNT(*) FROM inventory_ledger) inventory_ledger,
      (SELECT COUNT(*) FROM currency_ledger) currency_ledger,
      (SELECT COUNT(*) FROM package_catalog) package_catalog,
      (SELECT COUNT(*) FROM package_item_definitions) package_items,
      (SELECT COUNT(*) FROM package_reward_rules) package_rewards`))[0];
    if (Number(counts.definitions) !== fixture.definitionTotal || Number(counts.extras) !== fixture.extraDefinitions ||
        Number(counts.draw_rows) !== fixture.drawDefinitions || Number(counts.elite_objects) !== fixture.eliteDefinitions ||
        Number(counts.owned_mini_pets) !== 0 || Number(counts.package_catalog) !== 59 || Number(counts.package_items) !== 1260 || Number(counts.package_rewards) !== 242) {
      throw new Error(`preserved boundary mismatch:${JSON.stringify(counts)}`);
    }
    evidence.preserved = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)]));
  });

  await check("transaction rollback", async () => {
    const key = `${fixture.objectKeyPrefix}0001`;
    const before = (await connection.query("SELECT display_name FROM object_registry WHERE object_key=?", [key]))[0].display_name;
    await connection.beginTransaction();
    await connection.query("UPDATE object_registry SET display_name='ROLLBACK-PROBE' WHERE object_key=?", [key]);
    await connection.rollback();
    const after = (await connection.query("SELECT display_name FROM object_registry WHERE object_key=?", [key]))[0].display_name;
    if (before !== after) throw new Error("transaction rollback mismatch");
  });

  await connection.end();
  connection = await mariadb.createConnection(config);
  const reconnect = (await connection.query("SELECT COUNT(*) total FROM object_registry WHERE object_type='MINI_PET'"))[0];
  if (Number(reconnect.total) !== fixture.objects) throw new Error(`reconnect mismatch:${reconnect.total}`);
  checks.push("reconnect");
  console.log(JSON.stringify({ result: "passed", checks, total: checks.length, evidence }));
} finally {
  if (connection) await connection.end();
}
