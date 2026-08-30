import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const catalogVersion = "ASSET-FREEZE-v2.400-home-building-01";
const expectedRawHash = "73c93af3f0a5d52e4539047a21ce0d08f33603275ca542974eb11f47f93b2195";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sourcePath = path.join(repoRoot, "data/petSweetHomeInfo.json");
const fixturePath = path.join(repoRoot, "개발환경_고도화/migration-control/fixtures/synthetic-relational/home-building-definition-crosswalk-v1.json");
const migrationPath = path.join(repoRoot, "개발환경_고도화/runtime/migrations/395_home_building_definition_catalog.sql");

const raw = fs.readFileSync(sourcePath);
const source = JSON.parse(raw.toString("utf8"));
const sourceRows = source.homeInfo;
const rawHash = sha256(raw);
if (rawHash !== expectedRawHash || sourceRows.length !== 300) {
  throw new Error(`HOME_BUILDING_SOURCE_DRIFT:${sourceRows.length}:${rawHash}`);
}

const definitionBySignature = new Map();
const rows = sourceRows.map((row, index) => {
  const sourceIndex = index + 1;
  const signature = JSON.stringify(row);
  let definition = definitionBySignature.get(signature);
  if (!definition) {
    const firstSourceIndex = sourceIndex;
    definition = {
      definitionCode: `HOME-BUILDING-CATALOG-${String(firstSourceIndex).padStart(4, "0")}`,
      objectKey: `home.building.catalog_${String(firstSourceIndex).padStart(4, "0")}`,
      firstSourceIndex,
      definitionHash: sha256(signature),
      name: row.name,
      emoji: row.emoji,
      display: row.display
    };
    definitionBySignature.set(signature, definition);
  }
  return {
    sourceIndex,
    sourceKey: `source-row-${String(sourceIndex).padStart(4, "0")}`,
    ...definition,
    floor: Number(row.floor),
    exp: Number(row.exp),
    required: row.required ?? [],
    sourceRowHash: sha256(signature),
    sourceHash: rawHash,
    catalogVersion
  };
});

const definitions = [...definitionBySignature.values()];
const floor190 = rows.filter((row) => row.floor === 190);
const floor263 = rows.filter((row) => row.floor === 263);
if (definitions.length !== 299 || floor190.length !== 2 || new Set(floor190.map((row) => row.definitionCode)).size !== 2) {
  throw new Error(`HOME_BUILDING_DEFINITION_DRIFT:${definitions.length}:${floor190.length}`);
}
if (floor263.length !== 2 || floor263[0].definitionCode !== floor263[1].definitionCode ||
    floor263[0].sourceIndex !== 262 || floor263[1].sourceIndex !== 263) {
  throw new Error("HOME_BUILDING_FLOOR_263_DUPLICATE_DRIFT");
}

fs.writeFileSync(fixturePath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
fs.writeFileSync(migrationPath, buildMigration(rows, definitions), "utf8");
console.log(JSON.stringify({
  source: rows.length,
  definitions: definitions.length,
  progression: rows.length,
  sourceBindings: rows.length,
  floor190Definitions: new Set(floor190.map((row) => row.definitionCode)).size,
  floor263Definitions: new Set(floor263.map((row) => row.definitionCode)).size,
  sourceHash: rawHash,
  mappingHash: sha256(rows.map((row) => `${row.sourceIndex}\t${row.definitionCode}`).join("\n"))
}));

function buildMigration(catalogRows, canonicalDefinitions) {
  const objectValues = canonicalDefinitions.map((definition) => {
    const metadata = JSON.stringify({
      domain: "home_building_definition",
      definitionCode: definition.definitionCode,
      name: definition.name,
      emoji: definition.emoji,
      display: definition.display,
      firstSourceIndex: definition.firstSourceIndex,
      definitionHash: definition.definitionHash,
      catalogVersion
    });
    return `(${sql(definition.objectKey)},'HOME_BUILDING',${sql(definition.display)},1,TRUE,JSON_EXTRACT(${sql(metadata)},'$'))`;
  }).join(",\n");
  const progressionValues = catalogRows.map((row) =>
    `(${row.sourceIndex},${sql(row.objectKey)},${row.floor},${row.exp},JSON_EXTRACT(${sql(JSON.stringify(row.required))},'$'),${sql(row.sourceRowHash)})`
  ).join(",\n");
  return `SET NAMES utf8mb4;
START TRANSACTION;

CREATE TABLE IF NOT EXISTS home_building_progression (
  source_index INT UNSIGNED NOT NULL,
  home_building_object_id BIGINT UNSIGNED NOT NULL,
  object_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'HOME_BUILDING',
  floor_value INT UNSIGNED NOT NULL,
  experience_required BIGINT UNSIGNED NOT NULL,
  recipe_json JSON NOT NULL,
  source_row_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (source_index),
  KEY ix_home_building_progression_definition (home_building_object_id),
  KEY ix_home_building_progression_floor (floor_value,source_index),
  CONSTRAINT chk_home_building_progression_type CHECK (object_type='HOME_BUILDING'),
  CONSTRAINT fk_home_building_progression_object FOREIGN KEY (home_building_object_id,object_type)
    REFERENCES object_registry (id,object_type) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO object_registry(object_key,object_type,display_name,version,active,metadata_json) VALUES
${objectValues}
ON DUPLICATE KEY UPDATE
  object_type=VALUES(object_type),display_name=VALUES(display_name),active=TRUE,metadata_json=VALUES(metadata_json),updated_at=UTC_TIMESTAMP(3);

CREATE TEMPORARY TABLE tmp_home_building_progression (
  source_index INT UNSIGNED NOT NULL,
  object_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  floor_value INT UNSIGNED NOT NULL,
  experience_required BIGINT UNSIGNED NOT NULL,
  recipe_json JSON NOT NULL,
  source_row_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (source_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tmp_home_building_progression(source_index,object_key,floor_value,experience_required,recipe_json,source_row_hash) VALUES
${progressionValues};

INSERT INTO home_building_progression
  (source_index,home_building_object_id,object_type,floor_value,experience_required,recipe_json,source_row_hash,source_hash,catalog_version)
SELECT source_row.source_index,object_row.id,'HOME_BUILDING',source_row.floor_value,source_row.experience_required,
       source_row.recipe_json,source_row.source_row_hash,${sql(expectedRawHash)},${sql(catalogVersion)}
FROM tmp_home_building_progression source_row
JOIN object_registry object_row ON object_row.object_key=source_row.object_key AND object_row.object_type='HOME_BUILDING'
ORDER BY source_row.source_index
ON DUPLICATE KEY UPDATE
  home_building_object_id=VALUES(home_building_object_id),object_type=VALUES(object_type),floor_value=VALUES(floor_value),
  experience_required=VALUES(experience_required),recipe_json=VALUES(recipe_json),source_row_hash=VALUES(source_row_hash),
  source_hash=VALUES(source_hash),catalog_version=VALUES(catalog_version),updated_at=UTC_TIMESTAMP(3);

INSERT INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key)
SELECT progression.home_building_object_id,'HOME_BUILDING','LEGACY_JSON','petSweetHomeInfo.homeInfo',
       CONCAT('source-row-',LPAD(progression.source_index,4,'0'))
FROM home_building_progression progression
WHERE progression.catalog_version=${sql(catalogVersion)}
ORDER BY progression.source_index
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id),object_type=VALUES(object_type);

DROP TEMPORARY TABLE tmp_home_building_progression;
COMMIT;
`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sql(value) {
  return `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}
