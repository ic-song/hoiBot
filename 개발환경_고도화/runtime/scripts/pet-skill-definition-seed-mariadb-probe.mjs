import mariadb from "mariadb";

const connection = await mariadb.createConnection({
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33310"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_pet_skill_definition_seed_probe"
});
const checks = [];

async function check(name, work) {
  await work();
  checks.push(name);
}

try {
  await check("definition totals", async () => {
    const rows = await connection.query("SELECT COUNT(*) AS total, SUM(active=TRUE) AS active FROM skill_definitions");
    if (Number(rows[0].total) !== 93 || Number(rows[0].active) !== 93) throw new Error("definition total mismatch");
  });
  await check("source object parity", async () => {
    const rows = await connection.query(
      "SELECT COUNT(*) AS total, COUNT(DISTINCT r.object_key) AS object_keys, " +
      "COUNT(DISTINCT a.alias_value) AS aliases, COUNT(DISTINCT s.source_key) AS sources " +
      "FROM object_registry r " +
      "JOIN object_aliases a ON a.object_id=r.id AND a.object_type=r.object_type AND a.alias_type='legacy_name' " +
      "JOIN object_source_bindings s ON s.object_id=r.id AND s.object_type=r.object_type " +
      "WHERE r.object_type='SKILL' AND s.source_system='LEGACY_JSON' AND s.source_table='PET_SKILL_LIST'"
    );
    if ([rows[0].total, rows[0].object_keys, rows[0].aliases, rows[0].sources].some((value) => Number(value) !== 90)) {
      throw new Error("source object parity mismatch");
    }
  });
  await check("definition link parity", async () => {
    const rows = await connection.query(
      "SELECT COUNT(*) AS total FROM object_registry r JOIN skill_definitions d " +
      "ON d.code=JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json,'$.definitionCode')) " +
      "WHERE r.object_type='SKILL' AND d.active=TRUE"
    );
    if (Number(rows[0].total) !== 90) throw new Error("definition link mismatch");
  });
  await check("grade and policy parity", async () => {
    const rows = await connection.query(
      "SELECT JSON_UNQUOTE(JSON_EXTRACT(d.rules_json,'$.catalog.grade')) AS grade, COUNT(*) AS total " +
      "FROM object_registry r JOIN skill_definitions d " +
      "ON d.code=JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json,'$.definitionCode')) " +
      "WHERE r.object_type='SKILL' GROUP BY grade ORDER BY grade"
    );
    const actual = Object.fromEntries(rows.map((row) => [row.grade, Number(row.total)]));
    const expected = { A: 23, B: 19, C: 21, D: 6, S: 18, SS: 3 };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("grade parity mismatch");
  });
  await check("ambiguous identity separation", async () => {
    const rows = await connection.query(
      "SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.definitionCode')) AS code " +
      "FROM object_registry WHERE object_type='SKILL' AND display_name IN ('십원','구원') ORDER BY display_name"
    );
    const codes = rows.map((row) => row.code).sort();
    if (JSON.stringify(codes) !== JSON.stringify(["pet_skill_salvation","pet_skill_ten_won"])) {
      throw new Error("pet/trial identity mismatch");
    }
    const trial = await connection.query(
      "SELECT COUNT(*) AS total FROM skill_definitions WHERE code IN ('trial_ten_won','trial_salvation')"
    );
    if (Number(trial[0].total) !== 2) throw new Error("trial compatibility definitions missing");
  });
  console.log(JSON.stringify({ result: "passed", checks, total: checks.length }));
} finally {
  await connection.end();
}
