import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sourceRevision = "5925b83b1dbfb78ef583354604e112b9430003f3";
const sourcePath = "data/petSweetHomeInfo.json";
const sourceSha256 = "726385f7c9b9aed94bcb62c2eb6f9267e32d6a90a4216b50175cdfded878744b";
const sourceGitObjectSha256 = "9aa01517393750942992547223445ad0c77f0351d4a6700c05c36bd10cc7e288";
const baselineSha256 = "73c93af3f0a5d52e4539047a21ce0d08f33603275ca542974eb11f47f93b2195";
const catalogVersion = "ASSET-FREEZE-v2.438-home-furniture-draw-01";
const sourceTable = "petSweetHomeInfo.furnitureDraw.v2_438";
const rateScale = 10_000_000;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturePath = path.join(repoRoot, "개발환경_고도화/migration-control/fixtures/synthetic-relational/home-furniture-draw-parity-v2438.json");
const migrationPath = path.join(repoRoot, "개발환경_고도화/runtime/migrations/426_home_furniture_draw_parity.sql");
const rollbackPath = path.join(repoRoot, "개발환경_고도화/migration-control/rollback/426_home_furniture_draw_parity.sql");
const evidencePath = path.join(repoRoot, "개발환경_고도화/migration-control/evidence/home-furniture-draw-parity/slice.json");

const baselineRaw = fs.readFileSync(path.join(repoRoot, sourcePath));
const approvedRaw = execFileSync("git", ["cat-file", "blob", `${sourceRevision}:${sourcePath}`], { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 });
if (sha256(baselineRaw) !== baselineSha256) throw new Error("HOME_FURNITURE_BASELINE_HASH_DRIFT");
if (sha256(approvedRaw) !== sourceGitObjectSha256) throw new Error("HOME_FURNITURE_APPROVED_GIT_OBJECT_HASH_DRIFT");
if (sha256(approvedRaw.toString("utf8").replace(/\n/g, "\r\n")) !== sourceSha256) throw new Error("HOME_FURNITURE_APPROVED_OPERATIONAL_HASH_DRIFT");
const baseline = JSON.parse(baselineRaw.toString("utf8")).furniture;
const approved = JSON.parse(approvedRaw.toString("utf8")).furniture;
if (!Array.isArray(baseline) || !Array.isArray(approved)) throw new Error("HOME_FURNITURE_SOURCE_MISSING");

const baselineCodeBySignature = new Map();
for (let index = 0; index < baseline.length; index++) {
  const row = validateRow(baseline[index], `baseline:${index + 1}`);
  const signature = signatureOf(row);
  if (!baselineCodeBySignature.has(signature)) baselineCodeBySignature.set(signature, `HOME-DRAW-${String(index + 1).padStart(4, "0")}`);
}

const gradeOrdinalByName = new Map();
const gradeBands = [];
const definitionBySignature = new Map();
const occurrences = [];
const withinGrade = new Map();
for (let index = 0; index < approved.length; index++) {
  const row = validateRow(approved[index], `approved:${index + 1}`);
  if (!gradeOrdinalByName.has(row.grade)) {
    const ordinal = gradeOrdinalByName.size + 1;
    gradeOrdinalByName.set(row.grade, ordinal);
    gradeBands.push({ gradeOrdinal: ordinal, gradeDisplayName: row.grade, rateText: row.rate, weightScaled: scaleRate(row.rate), entryCount: 0 });
  }
  const gradeOrdinal = gradeOrdinalByName.get(row.grade);
  const band = gradeBands[gradeOrdinal - 1];
  if (band.rateText !== row.rate) throw new Error(`HOME_FURNITURE_NON_FIRST_RATE_DRIFT:${index + 1}`);
  band.entryCount++;
  const signature = signatureOf(row);
  let definition = definitionBySignature.get(signature);
  if (definition === undefined) {
    const reusedCode = baselineCodeBySignature.get(signature) ?? null;
    const canonicalCode = reusedCode ?? `HOME-DRAW-V2438-${sha256(signature).slice(0, 16)}`;
    definition = { canonicalCode, displayName: row.name, charmValue: row.exp, gradeDisplayName: row.grade, sourceDisplaySnapshot: row.display, signatureHash: sha256(signature), baselineReused: reusedCode !== null, firstSourceSequence: index + 1 };
    definitionBySignature.set(signature, definition);
  }
  const withinGradeSequence = (withinGrade.get(row.grade) ?? 0) + 1;
  withinGrade.set(row.grade, withinGradeSequence);
  occurrences.push({ sourceSequence: index + 1, withinGradeSequence, gradeOrdinal, gradeDisplayName: row.grade, canonicalCode: definition.canonicalCode, sourceDisplayName: row.name, charmValue: row.exp, sourceDisplaySnapshot: row.display, sourceRateText: row.rate, signatureHash: definition.signatureHash });
}

const definitions = [...definitionBySignature.values()];
const counts = {
  baselineRows: baseline.length, approvedRows: approved.length, sourceRowDelta: approved.length - baseline.length,
  baselineDefinitions: baselineCodeBySignature.size, approvedDefinitions: definitions.length,
  reusedDefinitions: definitions.filter((row) => row.baselineReused).length,
  newDefinitions: definitions.filter((row) => !row.baselineReused).length,
  duplicateGroups: [...countBy(occurrences, (row) => row.signatureHash).values()].filter((count) => count > 1).length,
  duplicateRows: [...countBy(occurrences, (row) => row.signatureHash).values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0),
  duplicateWeightOccurrences: approved.length - definitions.length,
  grades: gradeBands.length,
  logicalNames: new Set(approved.map((row) => row.name)).size,
  currentSourceBindings: occurrences.length
};
const expectedCounts = { baselineRows: 1551, approvedRows: 2447, sourceRowDelta: 896, baselineDefinitions: 1533, approvedDefinitions: 2422, reusedDefinitions: 1444, newDefinitions: 978, duplicateGroups: 9, duplicateRows: 34, duplicateWeightOccurrences: 25, grades: 7, logicalNames: 538, currentSourceBindings: 2447 };
if (JSON.stringify(counts) !== JSON.stringify(expectedCounts)) throw new Error(`HOME_FURNITURE_PARITY_DRIFT:${JSON.stringify(counts)}`);
if (new Set(definitions.map((row) => row.canonicalCode)).size !== definitions.length) throw new Error("HOME_FURNITURE_CODE_COLLISION");
if (JSON.stringify(gradeBands.map((row) => [row.gradeDisplayName,row.rateText,row.weightScaled,row.entryCount])) !== JSON.stringify([
  ["리브","0.99959",9995900,617],["쁘띠","0.0003",3000,400],["부띠끄","0.00005",500,400],["시그니엘","0.00003",300,551],["그랑 루미에르","0.00002",200,298],["로열 루미에르","0.00001",100,41],["아르카나 루미에르","0.0000065",65,140]
])) throw new Error("HOME_FURNITURE_GRADE_POLICY_DRIFT");

const fixture = { sliceId: "SL-ASSET-HOME-FURNITURE-DRAW-PARITY-01", catalogVersion, sourceRevision, sourcePath, sourceSha256, sourceGitObjectSha256, baselineSha256, sourceTable, rateScale, counts, gradeBands, definitions, occurrences };
for (const target of [fixturePath,migrationPath,rollbackPath,evidencePath]) fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
fs.writeFileSync(migrationPath, buildMigration(fixture), "utf8");
fs.writeFileSync(rollbackPath, buildRollback(), "utf8");
fs.writeFileSync(evidencePath, `${JSON.stringify({ sliceId: fixture.sliceId, catalogVersion, sourceRevision, sourceSha256, sourceGitObjectSha256, baselineSha256, counts, gradeBands, identityRule: "exact name+exp+grade+display signature; duplicate source rows remain ordered draw occurrences", carryForward: ["home furniture draw Gate1~7", "furniture object catalog Gate1~7", "existing ownership and draw provider"], scope: { providerAdded: false, ownershipChanged: false, consumerChanged: false, operationalDataTouched: false, gate8: false } }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ catalogVersion, ...counts }));

function buildMigration(frozen) {
  const newDefinitionValues = frozen.definitions.filter((row) => !row.baselineReused).map((row) => `(${sql(row.canonicalCode)},${sql(row.displayName)},${row.charmValue},${sql(row.signatureHash)})`).join(",\n");
  const definitionValues = frozen.definitions.map((row) => `(${sql(row.canonicalCode)},${sql(row.displayName)},${row.charmValue},${sql(row.gradeDisplayName)},${sql(row.sourceDisplaySnapshot)},${sql(row.signatureHash)},${row.baselineReused ? 1 : 0},${row.firstSourceSequence})`).join(",\n");
  const gradeValues = frozen.gradeBands.map((row) => `(@home_furniture_draw_catalog_id_426,${row.gradeOrdinal},${sql(row.gradeDisplayName)},${row.weightScaled},${row.entryCount})`).join(",\n");
  const occurrenceValues = frozen.occurrences.map((row) => `(${row.sourceSequence},${row.withinGradeSequence},${row.gradeOrdinal},${sql(row.canonicalCode)},${sql(row.sourceDisplayName)},${row.charmValue},${sql(row.sourceDisplaySnapshot)},${sql(row.sourceRateText)},${sql(row.signatureHash)})`).join(",\n");
  return `SET NAMES utf8mb4;
START TRANSACTION;

CREATE TEMPORARY TABLE tmp_home_furniture_new_definitions_426(code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,display_name VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,charm_value BIGINT UNSIGNED NOT NULL,signature_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE) ENGINE=InnoDB;
INSERT INTO tmp_home_furniture_new_definitions_426 VALUES
${newDefinitionValues};
INSERT INTO furniture_definitions(code,display_name,charm_value,active)
SELECT code,display_name,charm_value,TRUE FROM tmp_home_furniture_new_definitions_426 ORDER BY code
ON DUPLICATE KEY UPDATE code=VALUES(code);

CREATE TEMPORARY TABLE tmp_home_furniture_definitions_426(code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,display_name VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,charm_value BIGINT UNSIGNED NOT NULL,grade_display_name VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,source_display_snapshot VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,signature_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,baseline_reused BOOLEAN NOT NULL,first_source_sequence INT UNSIGNED NOT NULL) ENGINE=InnoDB;
INSERT INTO tmp_home_furniture_definitions_426 VALUES
${definitionValues};

INSERT INTO home_furniture_draw_catalog_versions(version_code,source_path,source_sha256,rate_scale,active)
VALUES(${sql(frozen.catalogVersion)},${sql(frozen.sourcePath)},${sql(frozen.sourceSha256)},${frozen.rateScale},TRUE)
ON DUPLICATE KEY UPDATE version_code=VALUES(version_code);
SET @home_furniture_draw_catalog_id_426=(SELECT id FROM home_furniture_draw_catalog_versions WHERE version_code=${sql(frozen.catalogVersion)} AND source_sha256=${sql(frozen.sourceSha256)} LIMIT 1);
UPDATE home_furniture_draw_catalog_versions SET active=(id=@home_furniture_draw_catalog_id_426) WHERE active=TRUE OR id=@home_furniture_draw_catalog_id_426;

INSERT INTO home_furniture_draw_grade_bands(catalog_version_id,grade_ordinal,grade_display_name,weight_scaled,entry_count) VALUES
${gradeValues}
ON DUPLICATE KEY UPDATE grade_ordinal=VALUES(grade_ordinal);

CREATE TEMPORARY TABLE tmp_home_furniture_occurrences_426(source_sequence INT UNSIGNED NOT NULL PRIMARY KEY,within_grade_sequence INT UNSIGNED NOT NULL,grade_ordinal TINYINT UNSIGNED NOT NULL,canonical_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,source_display_name VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,charm_value BIGINT UNSIGNED NOT NULL,source_display_snapshot VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,source_rate_text VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,signature_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL) ENGINE=InnoDB;
INSERT INTO tmp_home_furniture_occurrences_426 VALUES
${occurrenceValues};

INSERT INTO home_furniture_draw_entries(catalog_version_id,source_sequence,furniture_definition_id,grade_ordinal,within_grade_sequence,source_display_snapshot,source_rate_text)
SELECT @home_furniture_draw_catalog_id_426,row_data.source_sequence,definition_row.id,row_data.grade_ordinal,row_data.within_grade_sequence,row_data.source_display_snapshot,row_data.source_rate_text
FROM tmp_home_furniture_occurrences_426 row_data
JOIN furniture_definitions definition_row ON definition_row.code=row_data.canonical_code AND BINARY definition_row.display_name=BINARY row_data.source_display_name AND definition_row.charm_value=row_data.charm_value AND definition_row.active=TRUE
ORDER BY row_data.source_sequence
ON DUPLICATE KEY UPDATE source_sequence=VALUES(source_sequence);

INSERT INTO object_registry(object_key,object_type,display_name,version,active,metadata_json)
SELECT CONCAT('furniture.catalog_',LOWER(row_data.code)),'FURNITURE',row_data.display_name,1,TRUE,
       JSON_OBJECT('domain','home_furniture_definition','canonicalDefinitionCode',row_data.code,'normalizedDisplay',row_data.display_name,'charmValue',row_data.charm_value,'grade',row_data.grade_display_name,'signatureHash',row_data.signature_hash,'sourceHash',${sql(frozen.sourceSha256)},'catalogVersion',${sql(frozen.catalogVersion)})
FROM tmp_home_furniture_definitions_426 row_data ORDER BY row_data.first_source_sequence
ON DUPLICATE KEY UPDATE object_key=VALUES(object_key);

INSERT INTO object_aliases(object_id,object_type,alias_type,alias_value)
SELECT object_row.id,'FURNITURE','legacy_code',row_data.code
FROM tmp_home_furniture_definitions_426 row_data JOIN object_registry object_row ON object_row.object_key=CONCAT('furniture.catalog_',LOWER(row_data.code)) AND object_row.object_type='FURNITURE'
ORDER BY row_data.first_source_sequence
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id),object_type=VALUES(object_type);

INSERT INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key)
SELECT object_row.id,'FURNITURE','LEGACY_JSON',${sql(frozen.sourceTable)},CONCAT('source-row-',LPAD(row_data.source_sequence,4,'0'))
FROM tmp_home_furniture_occurrences_426 row_data JOIN object_registry object_row ON object_row.object_key=CONCAT('furniture.catalog_',LOWER(row_data.canonical_code)) AND object_row.object_type='FURNITURE'
ORDER BY row_data.source_sequence
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id),object_type=VALUES(object_type);

DROP TEMPORARY TABLE tmp_home_furniture_occurrences_426;
DROP TEMPORARY TABLE tmp_home_furniture_definitions_426;
DROP TEMPORARY TABLE tmp_home_furniture_new_definitions_426;
COMMIT;
`;
}

function buildRollback() {
  return `SET NAMES utf8mb4;
START TRANSACTION;
DELETE FROM object_source_bindings WHERE object_type='FURNITURE' AND source_system='LEGACY_JSON' AND source_table=${sql(sourceTable)};
DELETE alias_row FROM object_aliases alias_row JOIN object_registry object_row ON object_row.id=alias_row.object_id WHERE object_row.object_type='FURNITURE' AND object_row.object_key LIKE 'furniture.catalog_home-draw-v2438-%';
DELETE FROM object_registry WHERE object_type='FURNITURE' AND object_key LIKE 'furniture.catalog_home-draw-v2438-%';
SET @home_furniture_draw_catalog_id_426=(SELECT id FROM home_furniture_draw_catalog_versions WHERE version_code=${sql(catalogVersion)} LIMIT 1);
DELETE FROM home_furniture_draw_entries WHERE catalog_version_id=@home_furniture_draw_catalog_id_426;
DELETE FROM home_furniture_draw_grade_bands WHERE catalog_version_id=@home_furniture_draw_catalog_id_426;
DELETE FROM home_furniture_draw_catalog_versions WHERE id=@home_furniture_draw_catalog_id_426;
DELETE definition_row FROM furniture_definitions definition_row WHERE definition_row.code LIKE 'HOME-DRAW-V2438-%' AND NOT EXISTS(SELECT 1 FROM home_furniture_draw_entries entry_row WHERE entry_row.furniture_definition_id=definition_row.id) AND NOT EXISTS(SELECT 1 FROM furniture_inventory_instances instance_row WHERE instance_row.furniture_definition_id=definition_row.id) AND NOT EXISTS(SELECT 1 FROM owned_furniture owned_row WHERE owned_row.furniture_definition_id=definition_row.id);
UPDATE home_furniture_draw_catalog_versions SET active=(source_sha256=${sql(baselineSha256)});
COMMIT;
`;
}

function validateRow(row, location) {
  if (row === null || typeof row !== "object" || typeof row.name !== "string" || row.name === "" || typeof row.exp !== "string" || !/^\d+$/.test(row.exp) || typeof row.rate !== "string" || !/^0\.\d+$/.test(row.rate) || typeof row.grade !== "string" || row.grade === "" || typeof row.display !== "string" || row.display === "") throw new Error(`HOME_FURNITURE_ROW_DRIFT:${location}`);
  return row;
}
function signatureOf(row) { return `${row.name}\0${row.exp}\0${row.grade}\0${row.display}`; }
function scaleRate(value) { const [whole,fraction=""] = value.split("."); const padded=(fraction+"0000000").slice(0,7); if (fraction.length>7) throw new Error(`HOME_FURNITURE_RATE_SCALE_DRIFT:${value}`); return Number(whole)*rateScale+Number(padded); }
function countBy(rows, keyOf) { const counts=new Map(); for (const row of rows) { const key=keyOf(row); counts.set(key,(counts.get(key)??0)+1); } return counts; }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function sql(value) { return `'${String(value).replaceAll("'", "''")}'`; }
