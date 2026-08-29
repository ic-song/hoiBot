import mariadb from "mariadb";

const connection = await mariadb.createConnection({
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33310"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_object_catalog_probe"
});
const checks = [];

async function check(name, work) {
  await work();
  checks.push(name);
}

try {
  await check("seven object types", async () => {
    const rows = await connection.query(
      "SELECT COUNT(DISTINCT object_type) AS total FROM object_registry WHERE object_key <> 'item.test_retired'"
    );
    if (Number(rows[0].total) !== 7) throw new Error("object type count mismatch");
  });
  await check("typed alias cross-type", async () => {
    const rows = await connection.query(
      "SELECT COUNT(*) AS total FROM object_aliases WHERE alias_type='display_name' AND alias_value='테스트 공통'"
    );
    if (Number(rows[0].total) !== 2) throw new Error("cross-type aliases missing");
  });
  await check("typed alias collision", async () => {
    let rejected = false;
    try {
      await connection.query(
        "INSERT INTO object_aliases (object_id, object_type, alias_type, alias_value) " +
        "SELECT id, object_type, 'legacy_name', '물약' FROM object_registry WHERE object_key='item.test_retired'"
      );
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("same-type alias collision accepted");
  });
  await check("source binding unique", async () => {
    const rows = await connection.query("SELECT COUNT(*) AS total FROM object_source_bindings");
    if (Number(rows[0].total) !== 7) throw new Error("source binding count mismatch");
  });
  await check("inactive excluded", async () => {
    const rows = await connection.query("SELECT COUNT(*) AS total FROM object_registry WHERE active=TRUE");
    if (Number(rows[0].total) !== 7) throw new Error("inactive filter mismatch");
  });
  await check("invalid key constrained", async () => {
    let rejected = false;
    try {
      await connection.query(
        "INSERT INTO object_registry (object_key, object_type, display_name, metadata_json) " +
        "VALUES ('잘못된키','ITEM','실패',JSON_OBJECT())"
      );
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("invalid key accepted");
  });
  await check("optimistic version", async () => {
    const result = await connection.query(
      "UPDATE object_registry SET display_name=display_name, version=version+1 " +
      "WHERE object_key='item.test_potion' AND version=1"
    );
    if (Number(result.affectedRows) !== 1) {
      const rows = await connection.query(
        "SELECT version FROM object_registry WHERE object_key='item.test_potion'"
      );
      if (Number(rows[0].version) < 2) throw new Error("version did not advance");
    }
    const stale = await connection.query(
      "UPDATE object_registry SET display_name='stale' WHERE object_key='item.test_potion' AND version=1"
    );
    if (Number(stale.affectedRows) !== 0) throw new Error("stale version update accepted");
  });
  await check("fixture parity", async () => {
    const rows = await connection.query(
      "SELECT COUNT(*) AS objects, " +
      "(SELECT COUNT(*) FROM object_aliases) AS aliases, " +
      "(SELECT COUNT(*) FROM object_source_bindings) AS bindings FROM object_registry"
    );
    if (Number(rows[0].objects) !== 8 || Number(rows[0].aliases) !== 8 || Number(rows[0].bindings) !== 7) {
      throw new Error("fixture count mismatch");
    }
  });
  console.log(JSON.stringify({ result: "passed", checks, total: checks.length }));
} finally {
  await connection.end();
}
