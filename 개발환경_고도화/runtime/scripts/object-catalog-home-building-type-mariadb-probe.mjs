import mariadb from "mariadb";

const connection = await mariadb.createConnection({
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33310"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_object_catalog_home_building_type_probe"
});
const checks = [];

async function check(name, work) {
  await work();
  checks.push(name);
}

try {
  await check("nine type constraint", async () => {
    const rows = await connection.query(
      "SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS " +
      "WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'chk_object_registry_type'"
    );
    const clause = String(rows[0]?.CHECK_CLAUSE ?? "");
    for (const type of ["ITEM", "PET", "FURNITURE", "TITLE", "PET_TITLE", "PACKAGE", "CURRENCY", "SKILL", "HOME_BUILDING"]) {
      if (!clause.includes("'" + type + "'")) throw new Error("missing object type: " + type);
    }
  });
  await check("home building registry parity", async () => {
    const rows = await connection.query(
      "SELECT object_type, active FROM object_registry WHERE object_key = 'home_building.synthetic_catalog_check'"
    );
    if (rows.length !== 1 || rows[0].object_type !== "HOME_BUILDING" || !rows[0].active) {
      throw new Error("HOME_BUILDING registry fixture mismatch");
    }
  });
  await check("typed alias parity", async () => {
    const rows = await connection.query(
      "SELECT COUNT(*) AS total FROM object_aliases " +
      "WHERE object_type = 'HOME_BUILDING' AND alias_type = 'legacy_name' AND alias_value = '합성 홈 건물'"
    );
    if (Number(rows[0].total) !== 1) throw new Error("HOME_BUILDING alias mismatch");
  });
  await check("source binding parity", async () => {
    const rows = await connection.query(
      "SELECT COUNT(*) AS total FROM object_source_bindings " +
      "WHERE object_type = 'HOME_BUILDING' AND source_system = 'LEGACY_JSON' " +
      "AND source_table = 'HOME_BUILDING_LIST' AND source_key = 'synthetic_catalog_check'"
    );
    if (Number(rows[0].total) !== 1) throw new Error("HOME_BUILDING source binding mismatch");
  });
  await check("fixture replay", async () => {
    const rows = await connection.query(
      "SELECT " +
      "(SELECT COUNT(*) FROM object_registry WHERE object_key = 'home_building.synthetic_catalog_check') AS objects, " +
      "(SELECT COUNT(*) FROM object_aliases WHERE object_type = 'HOME_BUILDING' AND alias_value = '합성 홈 건물') AS aliases, " +
      "(SELECT COUNT(*) FROM object_source_bindings WHERE object_type = 'HOME_BUILDING' AND source_key = 'synthetic_catalog_check') AS bindings"
    );
    if (Number(rows[0].objects) !== 1 || Number(rows[0].aliases) !== 1 || Number(rows[0].bindings) !== 1) {
      throw new Error("fixture replay created duplicates");
    }
  });
  console.log(JSON.stringify({ result: "passed", checks, total: checks.length }));
} finally {
  await connection.end();
}
