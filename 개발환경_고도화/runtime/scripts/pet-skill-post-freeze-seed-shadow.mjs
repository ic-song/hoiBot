// legacy 93종과 canonical source-bound 93종의 read Shadow parity를 검증한다.
import crypto from "node:crypto";
import fs from "node:fs";
import mariadb from "mariadb";

const baseline = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pet-skill-definitions-v2400.json", import.meta.url), "utf8"));
const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pet-skill-post-freeze-v2435.json", import.meta.url), "utf8"));
const connection = await mariadb.createConnection({
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33310"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_pet_skill_post_freeze_probe"
});

// 객체 배열의 결정적 SHA-256 해시를 반환한다.
function sourceHash(rows) {
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

try {
  const rows = await connection.query(
    "SELECT r.object_key, r.display_name, JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json,'$.definitionCode')) AS definition_code, " +
    "JSON_UNQUOTE(JSON_EXTRACT(d.rules_json,'$.catalog.sourceKey')) AS source_key, " +
    "JSON_EXTRACT(d.rules_json,'$.catalog') AS catalog " +
    "FROM object_source_bindings s JOIN object_registry r ON r.id=s.object_id AND r.object_type=s.object_type " +
    "JOIN skill_definitions d ON d.code=JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json,'$.definitionCode')) " +
    "WHERE r.object_type='SKILL' AND r.active=TRUE AND d.active=TRUE AND s.source_system='LEGACY_JSON' AND s.source_table='PET_SKILL_LIST'"
  );
  const expectedNames = new Set([...baseline.map((row) => row.source.name), ...fixture.rows.map((row) => row.source.name)]);
  if (rows.length !== 93 || new Set(rows.map((row) => row.object_key)).size !== 93 || new Set(rows.map((row) => row.source_key)).size !== 93) {
    throw new Error("pet skill Shadow identity parity mismatch");
  }
  if (rows.some((row) => !expectedNames.has(row.display_name)) || rows.some((row) => fixture.commentedBacklog.includes(row.display_name))) {
    throw new Error("pet skill Shadow membership mismatch");
  }
  for (const expected of fixture.rows) {
    const actual = rows.find((row) => row.definition_code === expected.definitionCode);
    if (!actual) throw new Error(`missing post-freeze definition: ${expected.definitionCode}`);
    const catalog = typeof actual.catalog === "string" ? JSON.parse(actual.catalog) : actual.catalog;
    for (const [key, value] of Object.entries(expected.source)) {
      if (JSON.stringify(catalog[key]) !== JSON.stringify(value)) throw new Error(`semantic mismatch: ${expected.definitionCode}.${key}`);
    }
  }
  const current = baseline.map((row) => row.source);
  for (const row of [...fixture.rows].sort((a, b) => a.runtimeSourceIndex - b.runtimeSourceIndex)) current.splice(row.runtimeSourceIndex, 0, row.source);
  if (sourceHash(current) !== fixture.sourceHash) throw new Error("legacy source projection hash mismatch");
  console.log(JSON.stringify({ result: "passed", shadowChecks: ["active93", "stable-identity93", "semantic-payload3", "commented-backlog0", "source-hash", "ten-won/salvation-preserved"], counts: { legacy: current.length, canonical: rows.length, additions: fixture.rows.length, commented: 0 } }));
} finally {
  await connection.end();
}
