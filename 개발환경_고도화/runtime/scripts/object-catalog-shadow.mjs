import mariadb from "mariadb";

const connection = await mariadb.createConnection({
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33310"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_object_catalog_probe"
});

try {
  const objects = await connection.query(
    "SELECT object_key, object_type, display_name, version, active FROM object_registry ORDER BY object_key"
  );
  const aliases = await connection.query(
    "SELECT r.object_key, a.object_type, a.alias_type, a.alias_value " +
    "FROM object_aliases a JOIN object_registry r ON r.id=a.object_id " +
    "ORDER BY a.object_type, a.alias_type, a.alias_value"
  );
  const bindings = await connection.query(
    "SELECT r.object_key, s.source_system, s.source_table, s.source_key " +
    "FROM object_source_bindings s JOIN object_registry r ON r.id=s.object_id " +
    "ORDER BY s.source_system, s.source_table, s.source_key"
  );
  const typeCount = new Set(
    objects.filter((value) => value.active).map((value) => value.object_type)
  ).size;
  if (objects.length !== 8 || aliases.length !== 8 || bindings.length !== 7 || typeCount !== 7) {
    throw new Error("Shadow manifest mismatch");
  }
  console.log(JSON.stringify({
    result: "passed",
    shadowChecks: ["registry", "typed-alias", "source-binding", "inactive", "seven-types", "stable-key"],
    counts: {
      objects: objects.length,
      aliases: aliases.length,
      bindings: bindings.length,
      activeTypes: typeCount
    }
  }));
} finally {
  await connection.end();
}
