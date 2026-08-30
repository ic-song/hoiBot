import fs from "node:fs";
import mariadb from "mariadb";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/minipet-object-catalog-link-v1.json", import.meta.url), "utf8"));
const connection = await mariadb.createConnection({
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33397"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_minipet_object_catalog_link_probe"
});

try {
  const rows = await connection.query(`SELECT canonical.source_index,canonical.source_key,canonical.compatibility_code,
    definition_row.code definition_code,object_row.object_key,alias_row.alias_value,source_row.source_key linked_source_key
    FROM mini_pet_definition_source_bindings canonical
    JOIN mini_pet_definitions definition_row ON definition_row.id=canonical.mini_pet_definition_id
    JOIN object_registry object_row ON object_row.object_key=CONCAT('mini_pet.catalog_',LPAD(canonical.source_index,4,'0')) AND object_row.object_type='MINI_PET'
    JOIN object_aliases alias_row ON alias_row.object_id=object_row.id AND alias_row.alias_type='legacy_code'
    JOIN object_source_bindings source_row ON source_row.object_id=object_row.id
      AND source_row.source_system=canonical.source_system AND source_row.source_table=canonical.source_table AND source_row.source_key=canonical.source_key
    WHERE canonical.catalog_version=? ORDER BY canonical.source_index`, [fixture.sourceCatalogVersion]);
  if (rows.length !== fixture.sourceRows) throw new Error(`MINI_PET_SHADOW_COUNT:${rows.length}`);
  rows.forEach((row, offset) => {
    const sourceIndex = offset + 1;
    if (Number(row.source_index) !== sourceIndex || row.object_key !== `${fixture.objectKeyPrefix}${String(sourceIndex).padStart(4, "0")}` ||
        row.alias_value !== row.compatibility_code || row.linked_source_key !== row.source_key) {
      throw new Error(`MINI_PET_SHADOW_MISMATCH:${sourceIndex}`);
    }
  });
  console.log(JSON.stringify({ result: "passed", matched: rows.length, source: fixture.sourceRows, objects: fixture.objects,
    aliases: fixture.aliases, sourceBindings: fixture.sourceBindings, collisionSurplus: fixture.collisionSurplus,
    extraDefinitionsUnlinked: fixture.extraDefinitions, protectedConsumersTouched: false }));
} finally {
  await connection.end();
}
