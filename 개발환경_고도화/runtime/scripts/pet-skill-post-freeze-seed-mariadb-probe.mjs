// post-freeze 펫스킬 3종의 MariaDB canonical parity를 검증한다.
import mariadb from "mariadb";

const connection = await mariadb.createConnection({
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33310"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_pet_skill_post_freeze_probe"
});
const checks = [];

// 이름 붙은 비동기 검증을 실행하고 통과 목록에 기록한다.
async function check(name, work) {
  await work();
  checks.push(name);
}

try {
  await check("physical definition compatibility total", async () => {
    const rows = await connection.query("SELECT COUNT(*) AS total, SUM(active=TRUE) AS active FROM skill_definitions");
    if (Number(rows[0].total) !== 96 || Number(rows[0].active) !== 96) throw new Error("physical definition total mismatch");
  });
  await check("active source parity 93", async () => {
    const rows = await connection.query(
      "SELECT COUNT(*) AS total, SUM(d.active=TRUE AND r.active=TRUE) AS active, " +
      "COUNT(DISTINCT r.object_key) AS object_keys, COUNT(DISTINCT s.source_key) AS sources " +
      "FROM object_source_bindings s JOIN object_registry r ON r.id=s.object_id AND r.object_type=s.object_type " +
      "JOIN skill_definitions d ON d.code=JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json,'$.definitionCode')) " +
      "WHERE r.object_type='SKILL' AND s.source_system='LEGACY_JSON' AND s.source_table='PET_SKILL_LIST'"
    );
    if ([rows[0].total, rows[0].active, rows[0].object_keys, rows[0].sources].some((value) => Number(value) !== 93)) {
      throw new Error("active source parity mismatch");
    }
  });
  await check("three additions exact", async () => {
    const rows = await connection.query(
      "SELECT d.code, d.display_name, s.source_key, " +
      "CAST(JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json,'$.sourceIndex')) AS UNSIGNED) AS source_index, " +
      "CAST(JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json,'$.runtimeSourceIndex')) AS UNSIGNED) AS runtime_index, " +
      "JSON_UNQUOTE(JSON_EXTRACT(d.rules_json,'$.catalog.sourceHash')) AS source_hash " +
      "FROM skill_definitions d JOIN object_registry r ON d.code=JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json,'$.definitionCode')) " +
      "JOIN object_source_bindings s ON s.object_id=r.id AND s.object_type=r.object_type " +
      "WHERE d.code IN ('pet_skill_legendary_club','pet_skill_musou_ghost','pet_skill_musou_myth') ORDER BY source_index"
    );
    const compact = rows.map((row) => [row.code, row.display_name, row.source_key, Number(row.source_index), Number(row.runtime_index), row.source_hash]);
    const expected = [
      ["pet_skill_legendary_club", "전설의 몽둥이", "skill_090", 90, 0, "435a49512498b33295734e7dc864628792a47409b1e818c047d0051b2f15d176"],
      ["pet_skill_musou_ghost", "무쌍귀신", "skill_091", 91, 29, "435a49512498b33295734e7dc864628792a47409b1e818c047d0051b2f15d176"],
      ["pet_skill_musou_myth", "무쌍신화", "skill_092", 92, 41, "435a49512498b33295734e7dc864628792a47409b1e818c047d0051b2f15d176"]
    ];
    if (JSON.stringify(compact) !== JSON.stringify(expected)) throw new Error("post-freeze definition mismatch");
  });
  await check("commented backlog excluded", async () => {
    const rows = await connection.query("SELECT COUNT(*) AS total FROM skill_definitions WHERE display_name IN ('길드의 심장','기사도','야호','성실한 일꾼')");
    if (Number(rows[0].total) !== 0) throw new Error("commented backlog was seeded");
  });
  await check("identity and replay uniqueness", async () => {
    const rows = await connection.query(
      "SELECT COUNT(*) AS rows_total, COUNT(DISTINCT d.code) AS definitions, COUNT(DISTINCT r.object_key) AS objects, " +
      "COUNT(DISTINCT s.source_key) AS sources FROM skill_definitions d " +
      "JOIN object_registry r ON d.code=JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json,'$.definitionCode')) " +
      "JOIN object_source_bindings s ON s.object_id=r.id AND s.object_type=r.object_type " +
      "WHERE d.code IN ('pet_skill_legendary_club','pet_skill_musou_ghost','pet_skill_musou_myth')"
    );
    if ([rows[0].rows_total, rows[0].definitions, rows[0].objects, rows[0].sources].some((value) => Number(value) !== 3)) throw new Error("replay uniqueness mismatch");
    const trial = await connection.query("SELECT code FROM skill_definitions WHERE display_name IN ('십원','구원') ORDER BY code");
    const codes = trial.map((row) => row.code);
    if (!codes.includes("pet_skill_ten_won") || !codes.includes("pet_skill_salvation") || !codes.includes("trial_ten_won") || !codes.includes("trial_salvation")) {
      throw new Error("ten-won/salvation identity separation mismatch");
    }
  });
  console.log(JSON.stringify({ result: "passed", checks, total: checks.length, activeSourceParity: "93/93", physicalDefinitions: 96 }));
} finally {
  await connection.end();
}
