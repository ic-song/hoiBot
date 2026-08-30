import mariadb from "mariadb";

const connection = await mariadb.createConnection({
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33310"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_object_catalog_home_building_type_probe"
});

try {
  const rows = await connection.query(
    "SELECT r.object_key, r.object_type, r.display_name, r.active, " +
    "a.alias_value, s.source_system, s.source_table, s.source_key " +
    "FROM object_registry r " +
    "JOIN object_aliases a ON a.object_id = r.id AND a.object_type = r.object_type " +
    "JOIN object_source_bindings s ON s.object_id = r.id AND s.object_type = r.object_type " +
    "WHERE r.object_key = 'home_building.synthetic_catalog_check'"
  );
  const value = rows[0];
  if (
    rows.length !== 1 ||
    value.object_type !== "HOME_BUILDING" ||
    value.alias_value !== "합성 홈 건물" ||
    value.source_table !== "HOME_BUILDING_LIST" ||
    value.source_key !== "synthetic_catalog_check" ||
    !value.active
  ) {
    throw new Error("HOME_BUILDING Shadow manifest mismatch");
  }
  console.log(JSON.stringify({
    result: "passed",
    shadowChecks: ["registry", "typed-alias", "source-binding", "active", "stable-key"],
    objectKey: value.object_key,
    objectType: value.object_type
  }));
} finally {
  await connection.end();
}
