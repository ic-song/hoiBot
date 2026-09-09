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
const catalogVersion = "ASSET-FREEZE-v2.438-home-building-recipe-01";
const sourceTable = "petSweetHomeInfo.homeInfo.v2_438";
const requirementSourceTable = "petSweetHomeInfo.homeInfo.required.v2_438";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturePath = path.join(repoRoot, "개발환경_고도화/migration-control/fixtures/synthetic-relational/home-building-recipe-parity-v2438.json");
const migrationPath = path.join(repoRoot, "개발환경_고도화/runtime/migrations/428_home_building_recipe_parity.sql");
const rollbackPath = path.join(repoRoot, "개발환경_고도화/migration-control/rollback/428_home_building_recipe_parity.sql");
const evidencePath = path.join(repoRoot, "개발환경_고도화/migration-control/evidence/home-building-recipe-parity/slice.json");

const itemTargets = new Map([
  ["땅문서📜", { code: "land_document", objectKey: null, isNew: false }],
  ["돌멩이🪨", { code: "ITEM-RWD-041", objectKey: null, isNew: false }],
  ["펫 강화석⭐", { code: "pet_enhance_stone", objectKey: null, isNew: false }],
  ["철근⛓️", { code: "home_material_iron", objectKey: "item.home_material.iron", isNew: true }],
  ["양념치킨🐔", { code: "legacy-seasoned-chicken", objectKey: null, isNew: false }],
  ["목재🌳", { code: "home_material_wood", objectKey: "item.home_material.wood", isNew: true }],
  ["레이드타격대인장👑(+600👾)", { code: "ITEM-RWD-043", objectKey: null, isNew: false }],
  ["잡템☠️", { code: "junk", objectKey: null, isNew: false }],
  ["전설의 돌맹이🗿", { code: "ITEM-RWD-052", objectKey: null, isNew: false }],
  ["펫먹이🍼", { code: "pet_food", objectKey: null, isNew: false }]
]);

const baselineRaw = fs.readFileSync(path.join(repoRoot, sourcePath));
const approvedRaw = execFileSync("git", ["cat-file", "blob", `${sourceRevision}:${sourcePath}`], { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 });
if (sha256(baselineRaw) !== baselineSha256) throw new Error("HOME_BUILDING_BASELINE_HASH_DRIFT");
if (sha256(approvedRaw) !== sourceGitObjectSha256) throw new Error("HOME_BUILDING_APPROVED_GIT_OBJECT_HASH_DRIFT");
if (sha256(approvedRaw.toString("utf8").replace(/\n/g, "\r\n")) !== sourceSha256) throw new Error("HOME_BUILDING_APPROVED_OPERATIONAL_HASH_DRIFT");
const baseline = JSON.parse(baselineRaw.toString("utf8")).homeInfo;
const approved = JSON.parse(approvedRaw.toString("utf8")).homeInfo;
if (!Array.isArray(baseline) || !Array.isArray(approved)) throw new Error("HOME_BUILDING_SOURCE_MISSING");

const baselineObjectByIdentity = new Map();
for (let index = 0; index < baseline.length; index++) {
  const row = validateRow(baseline[index], `baseline:${index + 1}`);
  const identity = identityOf(row);
  if (!baselineObjectByIdentity.has(identity)) baselineObjectByIdentity.set(identity, `home.building.catalog_${String(index + 1).padStart(4, "0")}`);
}

const definitions = new Map();
const rows = [];
const requirements = [];
let changedRecipes = 0;
for (let index = 0; index < approved.length; index++) {
  const row = validateRow(approved[index], `approved:${index + 1}`);
  const baselineRow = validateRow(baseline[index], `baseline:${index + 1}`);
  const sourceSequence = index + 1;
  const identity = identityOf(row);
  const objectKey = baselineObjectByIdentity.get(identity);
  if (objectKey === undefined) throw new Error(`HOME_BUILDING_IDENTITY_GAP:${sourceSequence}`);
  if (JSON.stringify(row.required) !== JSON.stringify(baselineRow.required)) changedRecipes++;
  if (!definitions.has(identity)) definitions.set(identity, { objectKey, name: row.name, emoji: row.emoji, display: row.display, floor: Number(row.floor), experienceRequired: Number(row.exp), identityHash: sha256(identity), firstSourceSequence: sourceSequence });
  const recipeHash = sha256(JSON.stringify(row.required));
  rows.push({ sourceSequence, sourceKey: `source-row-${String(sourceSequence).padStart(4, "0")}`, objectKey, name: row.name, emoji: row.emoji, display: row.display, floor: Number(row.floor), experienceRequired: Number(row.exp), identityHash: sha256(identity), recipeHash, sourceRowHash: sha256(JSON.stringify(row)) });
  for (let requirementIndex = 0; requirementIndex < row.required.length; requirementIndex++) {
    const requirement = row.required[requirementIndex];
    const target = itemTargets.get(requirement.item);
    if (target === undefined) throw new Error(`HOME_BUILDING_ITEM_TARGET_GAP:${sourceSequence}:${requirement.item}`);
    requirements.push({ sourceSequence, requirementSequence: requirementIndex + 1, itemCode: target.code, sourceItemName: requirement.item, quantity: Number(requirement.count), requirementHash: sha256(JSON.stringify(requirement)) });
  }
}

const identityCounts = countBy(rows, (row) => row.identityHash);
const floor190 = rows.filter((row) => row.floor === 190);
const floor263 = rows.filter((row) => row.floor === 263);
const itemOccurrences = [...itemTargets].map(([displayName, target]) => {
  const matched = requirements.filter((row) => row.sourceItemName === displayName);
  return { displayName, code: target.code, objectKey: target.objectKey, isNew: target.isNew, occurrenceCount: matched.length, minQuantity: Math.min(...matched.map((row) => row.quantity)), maxQuantity: Math.max(...matched.map((row) => row.quantity)), quantities: [...new Set(matched.map((row) => row.quantity))].sort((left, right) => left - right) };
});
const counts = {
  baselineRows: baseline.length,
  approvedRows: approved.length,
  baselineDefinitions: baselineObjectByIdentity.size,
  approvedDefinitions: definitions.size,
  reusedDefinitions: definitions.size,
  changedRecipes,
  requirements: requirements.length,
  itemTargets: itemTargets.size,
  newItemTargets: itemOccurrences.filter((row) => row.isNew).length,
  duplicateIdentityGroups: [...identityCounts.values()].filter((count) => count > 1).length,
  duplicateIdentityRows: [...identityCounts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0),
  duplicateIdentityOccurrences: rows.length - definitions.size,
  floor190Rows: floor190.length,
  floor190Definitions: new Set(floor190.map((row) => row.identityHash)).size,
  floor263Rows: floor263.length,
  floor263Definitions: new Set(floor263.map((row) => row.identityHash)).size
};
const expectedCounts = { baselineRows: 300, approvedRows: 300, baselineDefinitions: 299, approvedDefinitions: 299, reusedDefinitions: 299, changedRecipes: 300, requirements: 2683, itemTargets: 10, newItemTargets: 2, duplicateIdentityGroups: 1, duplicateIdentityRows: 2, duplicateIdentityOccurrences: 1, floor190Rows: 2, floor190Definitions: 2, floor263Rows: 2, floor263Definitions: 1 };
if (JSON.stringify(counts) !== JSON.stringify(expectedCounts)) throw new Error(`HOME_BUILDING_PARITY_DRIFT:${JSON.stringify(counts)}`);
if (JSON.stringify(itemOccurrences.map((row) => [row.displayName, row.occurrenceCount])) !== JSON.stringify([["땅문서📜",300],["돌멩이🪨",300],["펫 강화석⭐",300],["철근⛓️",300],["양념치킨🐔",300],["목재🌳",300],["레이드타격대인장👑(+600👾)",140],["잡템☠️",291],["전설의 돌맹이🗿",251],["펫먹이🍼",201]])) throw new Error("HOME_BUILDING_ITEM_OCCURRENCE_DRIFT");

const fixture = { sliceId: "SL-ASSET-HOME-BUILDING-RECIPE-PARITY-01", catalogVersion, sourceRevision, sourcePath, sourceSha256, sourceGitObjectSha256, baselineSha256, sourceTable, requirementSourceTable, counts, itemOccurrences, definitions: [...definitions.values()], rows, requirements };
for (const targetPath of [fixturePath, migrationPath, rollbackPath, evidencePath]) fs.mkdirSync(path.dirname(targetPath), { recursive: true });
fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
fs.writeFileSync(migrationPath, buildMigration(fixture), "utf8");
fs.writeFileSync(rollbackPath, buildRollback(), "utf8");
fs.writeFileSync(evidencePath, `${JSON.stringify({ sliceId: fixture.sliceId, catalogVersion, sourceRevision, sourceSha256, sourceGitObjectSha256, baselineSha256, counts, itemOccurrences, identityRule: "building identity is exact name+emoji+display+floor+exp; ordered recipe requirements are versioned separately", carryForward: ["home building definition Gate1~7", "home recipe item gap Gate1~7", "existing building and item ownership/provider"], scope: { providerAdded: false, ownershipChanged: false, consumerChanged: false, operationalDataTouched: false, gate8: false } }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ catalogVersion, ...counts }));

function buildMigration(frozen) {
  const rowValues = frozen.rows.map((row) => `(${row.sourceSequence},${sql(row.objectKey)},${row.floor},${row.experienceRequired},${sql(row.identityHash)},${sql(row.recipeHash)},${sql(row.sourceRowHash)})`).join(",\n");
  const requirementValues = frozen.requirements.map((row) => `(${row.sourceSequence},${row.requirementSequence},${sql(row.itemCode)},${sql(row.sourceItemName)},${row.quantity},${sql(row.requirementHash)})`).join(",\n");
  return `SET NAMES utf8mb4;
START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
('home_material_iron','철근⛓️','STACK',TRUE,JSON_OBJECT('domain','home_building_recipe','ownershipModel','STACK','catalogVersion',${sql(catalogVersion)}),TRUE,1),
('home_material_wood','목재🌳','STACK',TRUE,JSON_OBJECT('domain','home_building_recipe','ownershipModel','STACK','catalogVersion',${sql(catalogVersion)}),TRUE,1)
ON DUPLICATE KEY UPDATE code=VALUES(code);

INSERT INTO object_registry(object_key,object_type,display_name,version,active,metadata_json) VALUES
('item.home_material.iron','ITEM','철근⛓️',1,TRUE,JSON_OBJECT('domain','home_building_recipe','canonicalDefinitionCode','home_material_iron','ownershipModel','STACK','catalogVersion',${sql(catalogVersion)})),
('item.home_material.wood','ITEM','목재🌳',1,TRUE,JSON_OBJECT('domain','home_building_recipe','canonicalDefinitionCode','home_material_wood','ownershipModel','STACK','catalogVersion',${sql(catalogVersion)}))
ON DUPLICATE KEY UPDATE object_key=VALUES(object_key);

INSERT INTO object_aliases(object_id,object_type,alias_type,alias_value)
SELECT id,'ITEM','legacy_name','철근⛓️' FROM object_registry WHERE object_key='item.home_material.iron' AND object_type='ITEM'
UNION ALL SELECT id,'ITEM','legacy_name','목재🌳' FROM object_registry WHERE object_key='item.home_material.wood' AND object_type='ITEM'
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id),object_type=VALUES(object_type);

INSERT INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key)
SELECT id,'ITEM','RUNTIME_DB','item_definitions','home_material_iron' FROM object_registry WHERE object_key='item.home_material.iron' AND object_type='ITEM'
UNION ALL SELECT id,'ITEM','LEGACY_JSON',${sql(requirementSourceTable)},'철근⛓️' FROM object_registry WHERE object_key='item.home_material.iron' AND object_type='ITEM'
UNION ALL SELECT id,'ITEM','RUNTIME_DB','item_definitions','home_material_wood' FROM object_registry WHERE object_key='item.home_material.wood' AND object_type='ITEM'
UNION ALL SELECT id,'ITEM','LEGACY_JSON',${sql(requirementSourceTable)},'목재🌳' FROM object_registry WHERE object_key='item.home_material.wood' AND object_type='ITEM'
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id),object_type=VALUES(object_type);

CREATE TABLE IF NOT EXISTS home_building_recipe_catalog_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  version_code VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_path VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  source_revision CHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  row_count INT UNSIGNED NOT NULL,
  requirement_count INT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(id), UNIQUE KEY uq_home_building_recipe_catalog_version(version_code),
  KEY ix_home_building_recipe_catalog_active(active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS home_building_recipe_rows (
  catalog_version_id BIGINT UNSIGNED NOT NULL,
  source_sequence INT UNSIGNED NOT NULL,
  home_building_object_id BIGINT UNSIGNED NOT NULL,
  object_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'HOME_BUILDING',
  floor_value INT UNSIGNED NOT NULL,
  experience_required BIGINT UNSIGNED NOT NULL,
  identity_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recipe_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_row_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY(catalog_version_id,source_sequence),
  KEY ix_home_building_recipe_row_object(home_building_object_id),
  KEY ix_home_building_recipe_row_floor(catalog_version_id,floor_value,source_sequence),
  CONSTRAINT fk_home_building_recipe_row_catalog FOREIGN KEY(catalog_version_id) REFERENCES home_building_recipe_catalog_versions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_home_building_recipe_row_object FOREIGN KEY(home_building_object_id,object_type) REFERENCES object_registry(id,object_type) ON DELETE RESTRICT,
  CONSTRAINT chk_home_building_recipe_row_type CHECK(object_type='HOME_BUILDING')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS home_building_recipe_requirements (
  catalog_version_id BIGINT UNSIGNED NOT NULL,
  source_sequence INT UNSIGNED NOT NULL,
  requirement_sequence INT UNSIGNED NOT NULL,
  item_definition_id BIGINT UNSIGNED NOT NULL,
  source_item_name VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  source_requirement_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY(catalog_version_id,source_sequence,requirement_sequence),
  KEY ix_home_building_recipe_requirement_item(item_definition_id),
  CONSTRAINT fk_home_building_recipe_requirement_row FOREIGN KEY(catalog_version_id,source_sequence) REFERENCES home_building_recipe_rows(catalog_version_id,source_sequence) ON DELETE RESTRICT,
  CONSTRAINT fk_home_building_recipe_requirement_item FOREIGN KEY(item_definition_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT chk_home_building_recipe_requirement_quantity CHECK(quantity>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO home_building_recipe_catalog_versions(version_code,source_path,source_revision,source_sha256,row_count,requirement_count,active)
VALUES(${sql(catalogVersion)},${sql(sourcePath)},${sql(sourceRevision)},${sql(sourceSha256)},${frozen.counts.approvedRows},${frozen.counts.requirements},TRUE)
ON DUPLICATE KEY UPDATE version_code=VALUES(version_code);
SET @home_building_recipe_catalog_id_428=(SELECT id FROM home_building_recipe_catalog_versions WHERE version_code=${sql(catalogVersion)} AND source_sha256=${sql(sourceSha256)} LIMIT 1);
UPDATE home_building_recipe_catalog_versions SET active=(id=@home_building_recipe_catalog_id_428) WHERE active=TRUE OR id=@home_building_recipe_catalog_id_428;

CREATE TEMPORARY TABLE tmp_home_building_recipe_rows_428(source_sequence INT UNSIGNED NOT NULL PRIMARY KEY,object_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,floor_value INT UNSIGNED NOT NULL,experience_required BIGINT UNSIGNED NOT NULL,identity_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,recipe_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,source_row_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL) ENGINE=InnoDB;
INSERT INTO tmp_home_building_recipe_rows_428 VALUES
${rowValues};
INSERT INTO home_building_recipe_rows(catalog_version_id,source_sequence,home_building_object_id,object_type,floor_value,experience_required,identity_hash,recipe_hash,source_row_hash)
SELECT @home_building_recipe_catalog_id_428,row_data.source_sequence,object_row.id,'HOME_BUILDING',row_data.floor_value,row_data.experience_required,row_data.identity_hash,row_data.recipe_hash,row_data.source_row_hash
FROM tmp_home_building_recipe_rows_428 row_data JOIN object_registry object_row ON object_row.object_key=row_data.object_key AND object_row.object_type='HOME_BUILDING'
ORDER BY row_data.source_sequence ON DUPLICATE KEY UPDATE source_sequence=VALUES(source_sequence);

CREATE TEMPORARY TABLE tmp_home_building_requirements_428(source_sequence INT UNSIGNED NOT NULL,requirement_sequence INT UNSIGNED NOT NULL,item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,source_item_name VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,quantity BIGINT UNSIGNED NOT NULL,source_requirement_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,PRIMARY KEY(source_sequence,requirement_sequence)) ENGINE=InnoDB;
INSERT INTO tmp_home_building_requirements_428 VALUES
${requirementValues};
INSERT INTO home_building_recipe_requirements(catalog_version_id,source_sequence,requirement_sequence,item_definition_id,source_item_name,quantity,source_requirement_hash)
SELECT @home_building_recipe_catalog_id_428,row_data.source_sequence,row_data.requirement_sequence,item_row.id,row_data.source_item_name,row_data.quantity,row_data.source_requirement_hash
FROM tmp_home_building_requirements_428 row_data JOIN item_definitions item_row ON item_row.code=row_data.item_code AND BINARY item_row.display_name=BINARY row_data.source_item_name AND item_row.active=TRUE
ORDER BY row_data.source_sequence,row_data.requirement_sequence ON DUPLICATE KEY UPDATE requirement_sequence=VALUES(requirement_sequence);

INSERT INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key)
SELECT recipe_row.home_building_object_id,'HOME_BUILDING','LEGACY_JSON',${sql(sourceTable)},CONCAT('source-row-',LPAD(recipe_row.source_sequence,4,'0'))
FROM home_building_recipe_rows recipe_row WHERE recipe_row.catalog_version_id=@home_building_recipe_catalog_id_428
ORDER BY recipe_row.source_sequence ON DUPLICATE KEY UPDATE object_id=VALUES(object_id),object_type=VALUES(object_type);

DROP TEMPORARY TABLE tmp_home_building_requirements_428;
DROP TEMPORARY TABLE tmp_home_building_recipe_rows_428;
COMMIT;
`;
}

function buildRollback() {
  return `SET NAMES utf8mb4;
START TRANSACTION;
DELETE FROM object_source_bindings WHERE source_system='LEGACY_JSON' AND source_table=${sql(sourceTable)};
SET @home_building_recipe_catalog_id_428=(SELECT id FROM home_building_recipe_catalog_versions WHERE version_code=${sql(catalogVersion)} LIMIT 1);
DELETE FROM home_building_recipe_requirements WHERE catalog_version_id=@home_building_recipe_catalog_id_428;
DELETE FROM home_building_recipe_rows WHERE catalog_version_id=@home_building_recipe_catalog_id_428;
DELETE FROM home_building_recipe_catalog_versions WHERE id=@home_building_recipe_catalog_id_428;
DELETE binding_row FROM object_source_bindings binding_row JOIN object_registry object_row ON object_row.id=binding_row.object_id WHERE object_row.object_key IN ('item.home_material.iron','item.home_material.wood');
DELETE alias_row FROM object_aliases alias_row JOIN object_registry object_row ON object_row.id=alias_row.object_id WHERE object_row.object_key IN ('item.home_material.iron','item.home_material.wood');
DELETE FROM object_registry WHERE object_key IN ('item.home_material.iron','item.home_material.wood') AND object_type='ITEM';
DELETE FROM item_definitions WHERE code IN ('home_material_iron','home_material_wood');
COMMIT;
`;
}

function validateRow(row, location) {
  if (row === null || typeof row !== "object" || typeof row.name !== "string" || row.name === "" || typeof row.emoji !== "string" || row.emoji === "" || typeof row.display !== "string" || row.display === "" || !/^\d+$/.test(String(row.floor)) || !Number.isSafeInteger(Number(row.exp)) || !Array.isArray(row.required) || row.required.length === 0) throw new Error(`HOME_BUILDING_ROW_DRIFT:${location}`);
  for (const requirement of row.required) if (requirement === null || typeof requirement.item !== "string" || requirement.item === "" || !Number.isSafeInteger(Number(requirement.count)) || Number(requirement.count) <= 0) throw new Error(`HOME_BUILDING_REQUIREMENT_DRIFT:${location}`);
  return row;
}
function identityOf(row) { return JSON.stringify([row.name,row.emoji,row.display,String(row.floor),Number(row.exp)]); }
function countBy(rows, keyOf) { const counts = new Map(); for (const row of rows) { const key = keyOf(row); counts.set(key, (counts.get(key) ?? 0) + 1); } return counts; }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function sql(value) { return `'${String(value).replaceAll("'", "''")}'`; }
