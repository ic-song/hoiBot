// 동결된 운영 소스에서 post-freeze 펫스킬 3종의 fixture와 migration을 생성한다.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(RUNTIME_ROOT, "../..");
const SOURCE_REF = process.env.HOIBOT_PET_SKILL_SOURCE_REF || "8f075b4ef249543563e3338e8f3dd32046344880";
const CATALOG_VERSION = "ASSET-FREEZE-v2.435-8f075b4e-02";
const BASELINE_HASH = "595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f";
const COMMENTED_BACKLOG = ["길드의 심장", "기사도", "야호", "성실한 일꾼"];
const TARGETS = [
  { name: "전설의 몽둥이", sourceIndex: 90, runtimeSourceIndex: 0, sourceKey: "skill_090", objectKey: "skill.pet_skill_090", definitionCode: "pet_skill_legendary_club" },
  { name: "무쌍귀신", sourceIndex: 91, runtimeSourceIndex: 29, sourceKey: "skill_091", objectKey: "skill.pet_skill_091", definitionCode: "pet_skill_musou_ghost" },
  { name: "무쌍신화", sourceIndex: 92, runtimeSourceIndex: 41, sourceKey: "skill_092", objectKey: "skill.pet_skill_092", definitionCode: "pet_skill_musou_myth" },
];
const BASELINE_FIXTURE = resolve(REPO_ROOT, "개발환경_고도화/migration-control/fixtures/synthetic-relational/pet-skill-definitions-v2400.json");
const OUTPUT_FIXTURE = resolve(REPO_ROOT, "개발환경_고도화/migration-control/fixtures/synthetic-relational/pet-skill-post-freeze-v2435.json");
const OUTPUT_MIGRATION = resolve(RUNTIME_ROOT, "migrations/408_pet_skill_post_freeze_seed.sql");

// 문자열의 SHA-256 해시를 반환한다.
function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// Git ref의 UTF-8 파일 내용을 읽는다.
function gitShow(ref, path) {
  return execFileSync("git", ["show", `${ref}:${path}`], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// PET_SKILL_LIST 배열 literal을 평가한다.
function readPetSkillList(source) {
  const match = source.match(/const PET_SKILL_LIST = (\[[\s\S]*?\n\]);/);
  if (!match) throw new Error("PET_SKILL_LIST not found");
  return vm.runInNewContext(`(${match[1]})`);
}

// SQL 문자열 literal 값을 안전하게 만든다.
function sqlText(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// JSON을 MariaDB SQL 문자열 안에서 보존하도록 escape한다.
function sqlJson(value) {
  return JSON.stringify(value).replace(/\\/g, "\\\\").replace(/'/g, "''");
}

// 한 펫스킬의 canonical definition/object/binding seed SQL을 만든다.
function renderSeed(row, sourceHash) {
  const catalog = { ...row.source, sourceIndex: row.sourceIndex, runtimeSourceIndex: row.runtimeSourceIndex, sourceKey: row.sourceKey, sourceHash };
  const metadata = {
    catalogVersion: CATALOG_VERSION,
    definitionCode: row.definitionCode,
    sourceIndex: row.sourceIndex,
    runtimeSourceIndex: row.runtimeSourceIndex,
    sourceKey: row.sourceKey,
    sourceHash,
    grade: row.source.grade,
    rate: row.source.rate ?? 0,
    tierExclusive: row.source.tierExclusive === true,
    postFreeze: true,
  };
  return `INSERT INTO skill_definitions (code, display_name, rules_json, active)
VALUES (${sqlText(row.definitionCode)}, ${sqlText(row.source.name)}, JSON_OBJECT('catalog', JSON_EXTRACT('${sqlJson(catalog)}', '$')), TRUE)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  rules_json = JSON_MERGE_PATCH(COALESCE(skill_definitions.rules_json, JSON_OBJECT()), JSON_OBJECT('catalog', JSON_EXTRACT('${sqlJson(catalog)}', '$'))),
  active = TRUE;

INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json)
VALUES (${sqlText(row.objectKey)}, 'SKILL', ${sqlText(row.source.name)}, TRUE, JSON_EXTRACT('${sqlJson(metadata)}', '$'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = TRUE,
  metadata_json = VALUES(metadata_json);

INSERT IGNORE INTO object_aliases (object_id, object_type, alias_type, alias_value)
SELECT id, object_type, 'legacy_name', ${sqlText(row.source.name)}
FROM object_registry WHERE object_key = ${sqlText(row.objectKey)};

INSERT IGNORE INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key)
SELECT id, object_type, 'LEGACY_JSON', 'PET_SKILL_LIST', ${sqlText(row.sourceKey)}
FROM object_registry WHERE object_key = ${sqlText(row.objectKey)};`;
}

const sourceText = gitShow(SOURCE_REF, "main.js");
const activeSkills = readPetSkillList(sourceText);
const baselineRows = JSON.parse(readFileSync(BASELINE_FIXTURE, "utf8"));
const targetNames = new Set(TARGETS.map((row) => row.name));
const baselineProjection = activeSkills.filter((row) => !targetNames.has(row.name));
const baselineSource = baselineRows.map((row) => row.source);
const sourceHash = sha256(JSON.stringify(activeSkills));

if (activeSkills.length !== 93 || baselineProjection.length !== 90) throw new Error("PET skill active count mismatch");
if (sha256(JSON.stringify(baselineProjection)) !== BASELINE_HASH || JSON.stringify(baselineProjection) !== JSON.stringify(baselineSource)) {
  throw new Error("frozen 90 baseline changed");
}
for (const name of COMMENTED_BACKLOG) {
  if (activeSkills.some((row) => row.name === name)) throw new Error(`commented backlog became active: ${name}`);
  if (!sourceText.includes(`// { name: "${name}"`)) throw new Error(`commented backlog source missing: ${name}`);
}

const rows = TARGETS.map((target) => {
  const source = activeSkills[target.runtimeSourceIndex];
  if (!source || source.name !== target.name) throw new Error(`runtime source index drift: ${target.name}`);
  return { ...target, reusedExisting: false, source };
});
const fixture = { catalogVersion: CATALOG_VERSION, sourceRef: SOURCE_REF, sourceHash, baselineHash: BASELINE_HASH, commentedBacklog: COMMENTED_BACKLOG, rows };
const migration = `START TRANSACTION;\n\n${rows.map((row) => renderSeed(row, sourceHash)).join("\n\n")}\n\nCOMMIT;\n`;

writeFileSync(OUTPUT_FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
writeFileSync(OUTPUT_MIGRATION, migration, "utf8");
console.log(JSON.stringify({ sourceRef: SOURCE_REF, sourceHash, active: activeSkills.length, baseline: baselineProjection.length, additions: rows.map((row) => ({ name: row.name, definitionCode: row.definitionCode, sourceKey: row.sourceKey, runtimeSourceIndex: row.runtimeSourceIndex })) }, null, 2));
