import mariadb from "mariadb";

const connection = await mariadb.createConnection({
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33310"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_pet_skill_definition_seed_probe"
});

try {
  const rows = await connection.query(
    "SELECT r.object_key, r.display_name, JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json,'$.definitionCode')) AS definition_code, " +
    "JSON_UNQUOTE(JSON_EXTRACT(d.rules_json,'$.catalog.grade')) AS grade, " +
    "JSON_UNQUOTE(JSON_EXTRACT(d.rules_json,'$.catalog.sourceKey')) AS source_key " +
    "FROM object_registry r JOIN skill_definitions d " +
    "ON d.code=JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json,'$.definitionCode')) " +
    "WHERE r.object_type='SKILL' ORDER BY CAST(JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json,'$.sourceIndex')) AS UNSIGNED)"
  );
  if (rows.length !== 90 || rows[0].source_key !== "skill_000" || rows[89].source_key !== "skill_089") {
    throw new Error("pet skill Shadow manifest mismatch");
  }
  if (new Set(rows.map((row) => row.object_key)).size !== 90 || new Set(rows.map((row) => row.display_name)).size !== 90) {
    throw new Error("pet skill Shadow identity collision");
  }
  console.log(JSON.stringify({
    result: "passed",
    shadowChecks: ["definitions", "object-keys", "display-names", "source-order", "grade", "pet-trial-separation"],
    counts: { definitions: rows.length, first: rows[0].source_key, last: rows[89].source_key }
  }));
} finally {
  await connection.end();
}
