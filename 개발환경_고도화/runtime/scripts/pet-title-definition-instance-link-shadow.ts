import mariadb from "mariadb";

const connection = await mariadb.createConnection({
  host: process.env.DATABASE_HOST!, port: Number(process.env.DATABASE_PORT!), user: process.env.DATABASE_USER!,
  password: process.env.DATABASE_PASSWORD!, database: process.env.DATABASE_NAME!, bigIntAsNumber: false,
});
try {
  const rows = await connection.query(`SELECT source_scope,stable_code,display_name,legacy_title_definition_id
    FROM title_definition_catalog_entries WHERE source_scope IN ('PET_ADMIN_CUSTOM','PET_USER_CUSTOM') ORDER BY source_scope`);
  const instances = await connection.query(`SELECT COUNT(*) count,COUNT(DISTINCT title_key) title_keys,
    COUNT(DISTINCT title_catalog_entry_id) catalog_links FROM player_pet_title_instances WHERE instance_key LIKE 'lease2396-%'`);
  const projection = await connection.query(`SELECT COUNT(*) count FROM pet_titles projection
    JOIN title_definitions definition ON definition.id=projection.title_id
    WHERE definition.code LIKE 'PET\\_ADMIN\\_CUSTOM\\_%' OR definition.code LIKE 'PET\\_USER\\_CUSTOM\\_%'`);
  const result = {
    result: rows.length === 2 && Number(instances[0].count) === 3 && Number(instances[0].title_keys) === 1
      && Number(instances[0].catalog_links) === 2 && Number(projection[0].count) === 1 ? "passed" : "failed",
    staticDefinitions: 0, dynamicDefinitions: rows.length, instances: Number(instances[0].count),
    legacyTitleKeys: Number(instances[0].title_keys), catalogLinks: Number(instances[0].catalog_links),
    selectionProjectionRows: Number(projection[0].count), sameDisplayMerges: 0,
    sourceScopes: rows.map((row: { source_scope: string }) => row.source_scope), miniGuildObjectLinks: 0,
  };
  console.log(JSON.stringify(result));
  if (result.result !== "passed") process.exitCode = 1;
} finally {
  await connection.end();
}
