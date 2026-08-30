import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const catalogVersion = "ASSET-FREEZE-v2.400-a286279b-01";
const expectedRawHash = "b361e9d2922a9e7997416f49e49187fd6924642a5aec8018ab68d6c8c9d2b5a7";
const expectedSourceHash = "7fd91bacee010ec3c4623ca34ddb92f647e7f30fa1d71a764eb38e320b79f644";
const expectedGradeHash = "a5bf87def79ee1a57e56e50f6b88833076ed43eb3f47103d2c77529e48d19602";
const expectedCollisionHash = "781cec45e42fa86363e5868fbe2bddc72eb64fa5016aa2434c9ab740bb7d461f";
const expectedMappingHash = "bf7019c2eb619947994bde524be2fd2c8f40a5d8f9d19a0771028ad59f36f9bf";

const normalizedGradeCodes = new Map(Object.entries({
  "일반": "normal",
  "고급": "advanced",
  "희귀": "rare",
  "영웅": "unique",
  "전설": "legendary",
  "전설+": "legendary_plus",
  "신화": "mythic",
  "신화+": "mythic_plus",
  "초월": "transcendent",
  "초월+": "transcendent_plus",
  "태초": "primordial",
  "태초+": "primordial_plus",
  "창세": "genesis",
  "창조": "creation",
  "엘리트": "elite"
}));
const plusGradeCodes = new Map(Object.entries({
  "전설+": "legendary_plus",
  "신화+": "mythic_plus",
  "초월+": "transcendent_plus"
}));

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sourcePath = path.join(repoRoot, "data/miniPetData.json");
const fixturePath = path.join(repoRoot, "개발환경_고도화/migration-control/fixtures/synthetic-relational/minipet-definition-crosswalk-v1.json");
const migrationPath = path.join(repoRoot, "개발환경_고도화/runtime/migrations/392_minipet_definition_catalog_normalization.sql");
const raw = fs.readFileSync(sourcePath);
const source = JSON.parse(raw.toString("utf8"));
const pets = source.miniPet;

const sourceHash = sha256(pets.map((pet, index) => sourceLine(pet, index)).join("\n"));
const gradeHash = sha256(source.gradeTable.map((row) => `${row.grade}\t${row.probability}`).join("\n"));
if (sha256(raw) !== expectedRawHash || sourceHash !== expectedSourceHash || gradeHash !== expectedGradeHash || pets.length !== 1078) {
  throw new Error(`MINIPET_SOURCE_DRIFT:${pets.length}:${sha256(raw)}:${sourceHash}:${gradeHash}`);
}

const collisionGroups = new Map();
pets.forEach((pet, index) => {
  const key = `${pet.name}\t${pet.grade}`;
  const group = collisionGroups.get(key) ?? [];
  group.push({ row: index + 1, emoji: pet.emoji, battleExp: pet.battleExp, castleExp: pet.castleExp, raidExp: pet.raidExp });
  collisionGroups.set(key, group);
});
const collisions = [...collisionGroups.entries()].filter(([, group]) => group.length > 1);
const collisionHash = sha256(collisions.map(([key, group]) => `${key}\t${group.map((row) => `${row.row}:${row.emoji}:${row.battleExp}:${row.castleExp}:${row.raidExp}`).join("|")}`).join("\n"));
if (collisionGroups.size !== 1055 || collisions.length !== 22 || collisions.reduce((sum, [, group]) => sum + group.length - 1, 0) !== 23 || collisionHash !== expectedCollisionHash) {
  throw new Error(`MINIPET_COLLISION_DRIFT:${collisionGroups.size}:${collisions.length}:${collisionHash}`);
}

const rows = pets.map((pet, index) => {
  const sourceIndex = index + 1;
  const compatibilityCode = `ITEM-MINIPET-CATALOG-${String(sourceIndex).padStart(4, "0")}`;
  const canonicalCode = sourceIndex <= 1066 ? compatibilityCode : `elite-combine-${String(sourceIndex - 1066).padStart(2, "0")}`;
  return {
    sourceIndex,
    sourceKey: `source-row-${String(sourceIndex).padStart(4, "0")}`,
    canonicalCode,
    compatibilityCode,
    name: pet.name,
    emoji: pet.emoji,
    displayName: `${pet.name}${pet.emoji}`,
    normalizedGradeCode: normalizedGradeCodes.get(pet.grade),
    plusGradeCode: plusGradeCodes.get(pet.grade) ?? null,
    gradeDisplayName: pet.grade,
    price: pet.price ?? null,
    battleExp: pet.battleExp,
    castleExp: pet.castleExp,
    raidExp: pet.raidExp,
    drawEligible: sourceIndex <= 1066,
    elite: sourceIndex > 1066,
    definitionReused: true,
    bindingStrategy: "MINI_PET_DEFINITION_SOURCE_BINDING",
    objectCatalogType: null,
    catalogVersion,
    sourceHash
  };
});

if (rows.some((row) => row.normalizedGradeCode === undefined)) throw new Error("MINIPET_GRADE_CODE_REQUIRED");
const mappingHash = sha256(rows.map((row) => `${row.sourceIndex}\t${row.canonicalCode}`).join("\n"));
if (mappingHash !== expectedMappingHash || new Set(rows.map((row) => row.canonicalCode)).size !== 1078) {
  throw new Error(`MINIPET_MAPPING_DRIFT:${mappingHash}`);
}

fs.writeFileSync(fixturePath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
fs.writeFileSync(migrationPath, buildMigration(rows), "utf8");
console.log(JSON.stringify({
  source: rows.length,
  sourceHash,
  gradeHash,
  nameGradeComposite: 1055,
  collisionGroups: 22,
  collisionSurplus: 23,
  collisionHash,
  reused: 1078,
  created: 0,
  extraPreserved: 28,
  drawEligible: 1066,
  elite: 12,
  objectCatalogBindings: 0,
  definitionSourceBindings: 1078,
  mappingHash
}));

function buildMigration(catalogRows) {
  const values = catalogRows.map((row) => `(${row.sourceIndex},${sql(row.sourceKey)},${sql(row.canonicalCode)},${sql(row.compatibilityCode)},${sql(row.name)},${sql(row.emoji)},${sql(row.gradeDisplayName)},${row.plusGradeCode === null ? "NULL" : sql(row.plusGradeCode)})`).join(",\n");
  return `SET NAMES utf8mb4;
START TRANSACTION;

CREATE TABLE IF NOT EXISTS mini_pet_definition_source_bindings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  mini_pet_definition_id BIGINT UNSIGNED NOT NULL,
  source_system VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_table VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_index INT UNSIGNED NOT NULL,
  compatibility_code VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mini_pet_definition_source (source_system,source_table,source_key),
  UNIQUE KEY uq_mini_pet_definition_source_index (source_system,source_table,source_index),
  UNIQUE KEY uq_mini_pet_definition_compatibility (compatibility_code),
  KEY ix_mini_pet_definition_binding_definition (mini_pet_definition_id),
  CONSTRAINT fk_mini_pet_definition_binding_definition FOREIGN KEY (mini_pet_definition_id)
    REFERENCES mini_pet_definitions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @mini_pet_grade_order := (SELECT COALESCE(MAX(grade_order),0) FROM mini_pet_grade_definitions);
INSERT INTO mini_pet_grade_definitions(grade_code,display_name,grade_order,active) VALUES
  ('legendary_plus','전설+',@mini_pet_grade_order+1,TRUE),
  ('mythic_plus','신화+',@mini_pet_grade_order+2,TRUE),
  ('transcendent_plus','초월+',@mini_pet_grade_order+3,TRUE)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  active=TRUE;

CREATE TEMPORARY TABLE tmp_minipet_definition_source_map (
  source_index INT UNSIGNED NOT NULL,
  source_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  canonical_code VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  compatibility_code VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_name VARCHAR(191) NOT NULL,
  source_emoji VARCHAR(191) NOT NULL,
  source_grade VARCHAR(191) NOT NULL,
  plus_grade_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (source_index),
  UNIQUE KEY uq_tmp_minipet_source_key (source_key),
  UNIQUE KEY uq_tmp_minipet_canonical_code (canonical_code),
  UNIQUE KEY uq_tmp_minipet_compatibility_code (compatibility_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tmp_minipet_definition_source_map
  (source_index,source_key,canonical_code,compatibility_code,source_name,source_emoji,source_grade,plus_grade_code)
VALUES
${values};

UPDATE mini_pet_definitions definition_row
JOIN tmp_minipet_definition_source_map source_row ON source_row.canonical_code=definition_row.code
SET definition_row.display_name=source_row.source_name,
    definition_row.grade_code=COALESCE(source_row.plus_grade_code,definition_row.grade_code),
    definition_row.grade_display_name=source_row.source_grade,
    definition_row.emoji_value=source_row.source_emoji;

INSERT INTO mini_pet_definition_source_bindings
  (mini_pet_definition_id,source_system,source_table,source_key,source_index,compatibility_code,source_hash,catalog_version)
SELECT definition_row.id,'LEGACY_JSON','miniPetData.miniPet',source_row.source_key,source_row.source_index,
       source_row.compatibility_code,'${expectedSourceHash}','${catalogVersion}'
FROM tmp_minipet_definition_source_map source_row
JOIN mini_pet_definitions definition_row ON definition_row.code=source_row.canonical_code
ORDER BY source_row.source_index
ON DUPLICATE KEY UPDATE
  mini_pet_definition_id=VALUES(mini_pet_definition_id),
  source_index=VALUES(source_index),
  compatibility_code=VALUES(compatibility_code),
  source_hash=VALUES(source_hash),
  catalog_version=VALUES(catalog_version),
  updated_at=UTC_TIMESTAMP(3);

DROP TEMPORARY TABLE tmp_minipet_definition_source_map;

COMMIT;
`;
}

function sourceLine(pet, index) {
  return [index + 1, pet.name, pet.emoji, pet.grade, pet.price ?? "", pet.battleExp, pet.castleExp, pet.raidExp].join("\t");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sql(value) {
  return `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}
