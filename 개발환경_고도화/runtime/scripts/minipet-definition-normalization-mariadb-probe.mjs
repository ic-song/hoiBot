import crypto from "node:crypto";
import fs from "node:fs";
import mariadb from "mariadb";

const rows = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/minipet-definition-crosswalk-v1.json", import.meta.url), "utf8"));
const connectionConfig = {
  host: process.env.HOIBOT_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.HOIBOT_DB_PORT ?? "33392"),
  user: process.env.HOIBOT_DB_USER ?? "root",
  password: process.env.HOIBOT_DB_PASSWORD ?? "",
  database: process.env.HOIBOT_DB_NAME ?? "hoibot_minipet_definition_probe"
};
let connection = await mariadb.createConnection(connectionConfig);
const checks = [];
const evidence = {};

async function check(name, work) {
  await work();
  checks.push(name);
}

try {
  await check("definition and binding totals", async () => {
    const definitions = (await connection.query("SELECT COUNT(*) total FROM mini_pet_definitions"))[0];
    const bindings = (await connection.query("SELECT COUNT(*) total,COUNT(DISTINCT mini_pet_definition_id) definitions,COUNT(DISTINCT source_key) source_keys,COUNT(DISTINCT compatibility_code) compatibility_codes FROM mini_pet_definition_source_bindings"))[0];
    if (Number(definitions.total) !== 1106) throw new Error(`definition total mismatch:${definitions.total}`);
    if ([bindings.total, bindings.definitions, bindings.source_keys, bindings.compatibility_codes].some((value) => Number(value) !== 1078)) throw new Error("binding total mismatch");
    evidence.definitionTotal = Number(definitions.total);
    evidence.bindingTotal = Number(bindings.total);
  });

  await check("source row exact parity", async () => {
    const records = await connection.query(
      "SELECT b.source_index,b.source_key,b.compatibility_code,d.code canonical_code,d.display_name,d.grade_code,d.grade_display_name,d.emoji_value " +
      "FROM mini_pet_definition_source_bindings b JOIN mini_pet_definitions d ON d.id=b.mini_pet_definition_id ORDER BY b.source_index"
    );
    if (records.length !== rows.length) throw new Error("source parity count mismatch");
    for (let index = 0; index < rows.length; index += 1) {
      const expected = rows[index];
      const actual = records[index];
      if (Number(actual.source_index) !== expected.sourceIndex || actual.source_key !== expected.sourceKey ||
          actual.compatibility_code !== expected.compatibilityCode || actual.canonical_code !== expected.canonicalCode ||
          actual.display_name !== expected.name || actual.grade_display_name !== expected.gradeDisplayName || actual.emoji_value !== expected.emoji ||
          (expected.plusGradeCode !== null && actual.grade_code !== expected.plusGradeCode)) {
        throw new Error(`source parity mismatch:${expected.sourceKey}`);
      }
    }
  });

  await check("plus grades and semantic aliases", async () => {
    const plusRows = await connection.query("SELECT grade_code,display_name,active FROM mini_pet_grade_definitions WHERE grade_code IN ('legendary_plus','mythic_plus','transcendent_plus') ORDER BY grade_code");
    const actualPlus = Object.fromEntries(plusRows.map((row) => [row.grade_code, row.display_name]));
    const expectedPlus = { legendary_plus: "전설+", mythic_plus: "신화+", transcendent_plus: "초월+" };
    if (JSON.stringify(actualPlus) !== JSON.stringify(expectedPlus) || plusRows.some((row) => !row.active)) throw new Error("plus grade mismatch");
    const aliases = await connection.query("SELECT grade_code,display_name FROM mini_pet_grade_definitions WHERE grade_code IN ('rare','unique','master') ORDER BY grade_code");
    const actualAliases = Object.fromEntries(aliases.map((row) => [row.grade_code, row.display_name]));
    const expectedAliases = { master: "마스터", rare: "레어", unique: "유니크" };
    if (JSON.stringify(actualAliases) !== JSON.stringify(expectedAliases)) throw new Error("semantic grade alias mismatch");
    evidence.semanticAliases = actualAliases;
  });

  await check("extra definitions preserved", async () => {
    const extras = await connection.query(
      "SELECT d.code,d.display_name,d.grade_display_name,d.active FROM mini_pet_definitions d " +
      "LEFT JOIN mini_pet_definition_source_bindings b ON b.mini_pet_definition_id=d.id WHERE b.id IS NULL ORDER BY d.code"
    );
    const inactiveCatalogElite = extras.filter((row) => /^ITEM-MINIPET-CATALOG-(106[7-9]|107[0-8])$/.test(row.code) && !row.active);
    if (extras.length !== 28 || inactiveCatalogElite.length !== 12) throw new Error(`extra definition mismatch:${extras.length}:${inactiveCatalogElite.length}`);
    evidence.extraTotal = extras.length;
    evidence.inactiveCatalogElite = inactiveCatalogElite.length;
    evidence.otherCompatibilityExtras = extras.length - inactiveCatalogElite.length;
    evidence.extraHash = sha256(extras.map((row) => `${row.code}\t${row.display_name}\t${row.grade_display_name ?? ""}\t${Number(row.active)}`).join("\n"));
    evidence.extraCodes = extras.map((row) => row.code);
  });

  await check("draw package ownership and object catalog preserved", async () => {
    const drawRows = await connection.query("SELECT item_id,grade_code,CAST(grade_weight AS CHAR) grade_weight,CAST(item_weight AS CHAR) item_weight,enabled FROM dynamic_item_catalog_entries WHERE catalog_code='legacy-mini-pet' ORDER BY item_id");
    const packageCounts = (await connection.query("SELECT (SELECT COUNT(*) FROM package_catalog) package_catalog,(SELECT COUNT(*) FROM package_item_definitions) package_items,(SELECT COUNT(*) FROM package_reward_rules) package_rewards,(SELECT COUNT(*) FROM owned_mini_pets) owned_mini_pets"))[0];
    const objectRows = (await connection.query("SELECT COUNT(*) total FROM object_registry WHERE object_type IN ('PET','MINI_PET') AND (object_key LIKE 'pet.minipet.%' OR JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.domain'))='mini_pet')"))[0];
    if (drawRows.length !== 1066 || Number(packageCounts.package_catalog) !== 59 || Number(packageCounts.package_items) !== 1260 || Number(packageCounts.package_rewards) !== 242 || Number(packageCounts.owned_mini_pets) !== 0 || Number(objectRows.total) !== 0) throw new Error("preserved domain count mismatch");
    evidence.drawCount = drawRows.length;
    evidence.drawHash = sha256(drawRows.map((row) => `${row.item_id}\t${row.grade_code}\t${row.grade_weight}\t${row.item_weight}\t${Number(row.enabled)}`).join("\n"));
    evidence.packageCounts = { catalog: Number(packageCounts.package_catalog), items: Number(packageCounts.package_items), rewards: Number(packageCounts.package_rewards) };
    evidence.ownedMiniPets = Number(packageCounts.owned_mini_pets);
    evidence.mislabelledObjects = Number(objectRows.total);
  });

  await check("transaction rollback", async () => {
    const before = (await connection.query("SELECT catalog_version FROM mini_pet_definition_source_bindings WHERE source_index=1"))[0].catalog_version;
    await connection.beginTransaction();
    await connection.query("UPDATE mini_pet_definition_source_bindings SET catalog_version='ROLLBACK-PROBE' WHERE source_index=1");
    await connection.rollback();
    const after = (await connection.query("SELECT catalog_version FROM mini_pet_definition_source_bindings WHERE source_index=1"))[0].catalog_version;
    if (before !== after) throw new Error("transaction rollback mismatch");
  });

  await connection.end();
  connection = await mariadb.createConnection(connectionConfig);
  const reconnect = (await connection.query("SELECT COUNT(*) total FROM mini_pet_definition_source_bindings"))[0];
  if (Number(reconnect.total) !== 1078) throw new Error("reconnect mismatch");
  checks.push("reconnect");
  console.log(JSON.stringify({ result: "passed", checks, total: checks.length, evidence }));
} finally {
  if (connection) await connection.end();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}
