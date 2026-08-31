import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sourceRevision = "5925b83b1dbfb78ef583354604e112b9430003f3";
const sourcePath = "data/itemList.json";
const sourceSha256 = "b6f4751f2faf7588c2e41c032bac4fc5b05ff6bd2c105ea0c57a0e072c60c402";
const catalogVersion = "ASSET-FREEZE-v2.435-item-restriction-occurrence-01";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturePath = path.join(repoRoot, "개발환경_고도화/migration-control/fixtures/synthetic-relational/asset-item-restriction-occurrence-v1.json");
const migrationPath = path.join(repoRoot, "개발환경_고도화/runtime/migrations/418_asset_item_restriction_occurrence_catalog.sql");
const rollbackPath = path.join(repoRoot, "개발환경_고도화/migration-control/rollback/418_asset_item_restriction_occurrence_catalog.sql");
const evidencePath = path.join(repoRoot, "개발환경_고도화/migration-control/evidence/asset-item-restriction-occurrence-catalog/slice.json");

const raw = execFileSync("git", ["show", `${sourceRevision}:${sourcePath}`], { cwd: repoRoot });
if (sha256(raw) !== sourceSha256) throw new Error(`ITEM_RESTRICTION_SOURCE_HASH_DRIFT:${sha256(raw)}`);
const source = JSON.parse(raw.toString("utf8"));
const policies = [
  buildPolicy("non_item", "nonItems", source.nonItems, 674, 670),
  buildPolicy("untradable", "untradableList", source.untradableList, 504, 503)
];
const duplicateGroups = policies.reduce((sum, policy) => sum + policy.definitions.filter((row) => row.occurrenceCount > 1).length, 0);
if (duplicateGroups !== 5) throw new Error(`ITEM_RESTRICTION_DUPLICATE_DRIFT:${duplicateGroups}`);

const fixture = { catalogVersion, sourceRevision, sourcePath, sourceSha256, policies };
fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
fs.mkdirSync(path.dirname(rollbackPath), { recursive: true });
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
fs.writeFileSync(migrationPath, buildMigration(fixture), "utf8");
fs.writeFileSync(rollbackPath, `START TRANSACTION;\nDROP TABLE IF EXISTS asset_item_restriction_occurrences;\nDROP TABLE IF EXISTS asset_item_restriction_definitions;\nDROP TABLE IF EXISTS asset_item_restriction_sets;\nCOMMIT;\n`, "utf8");
fs.writeFileSync(evidencePath, `${JSON.stringify({
  sliceId: "SL-ASSET-ITEM-RESTRICTION-OCCURRENCE-CATALOG-01",
  catalogVersion,
  sourceRevision,
  sourceSha256,
  sourceCounts: Object.fromEntries(policies.map((policy) => [policy.sourceKey, { rows: policy.rowCount, unique: policy.uniqueCount }])),
  totals: { sets: 2, definitions: policies.reduce((sum, policy) => sum + policy.uniqueCount, 0), occurrences: policies.reduce((sum, policy) => sum + policy.rowCount, 0), duplicateGroups },
  semantics: ["source order preserved", "duplicate occurrences preserved", "first matching occurrence removable without clearing later duplicates"],
  scope: { legacyChanged: false, operationalDataImported: false, existingRestrictionConsumerCutover: false, ownershipChanged: false, gate8: false }
}, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ catalogVersion, sourceSha256, sets: 2, definitions: 1173, occurrences: 1178, duplicateGroups }));

function buildPolicy(restrictionKind, sourceKey, values, expectedRows, expectedUnique) {
  if (!Array.isArray(values) || values.length !== expectedRows || new Set(values).size !== expectedUnique) {
    throw new Error(`ITEM_RESTRICTION_COUNT_DRIFT:${sourceKey}:${values?.length}:${new Set(values ?? []).size}`);
  }
  const byName = new Map();
  const occurrences = values.map((rawValue, offset) => {
    const sourceOrder = offset + 1;
    const definitionHash = sha256(`${restrictionKind}\0${rawValue}`);
    const current = byName.get(rawValue);
    if (current) current.occurrenceCount += 1;
    else byName.set(rawValue, { definitionHash, displayName: rawValue, firstSourceOrder: sourceOrder, occurrenceCount: 1 });
    return { sourceOrder, definitionHash, rawValue, sourceRowHash: sha256(`${sourceOrder}\0${rawValue}`) };
  });
  return { restrictionKind, sourceKey, rowCount: values.length, uniqueCount: byName.size, definitions: [...byName.values()], occurrences };
}

function buildMigration(frozen) {
  const setValues = frozen.policies.map((policy) => `(${sql(frozen.catalogVersion)},${sql(policy.restrictionKind)},'LEGACY_JSON',${sql(frozen.sourcePath)},${sql(policy.sourceKey)},${sql(frozen.sourceSha256)},${policy.rowCount},${policy.uniqueCount},'SHADOW')`).join(",\n");
  const definitionValues = frozen.policies.flatMap((policy) => policy.definitions.map((row) => `(${sql(policy.restrictionKind)},${sql(row.definitionHash)},${sql(row.displayName)},${row.firstSourceOrder},${row.occurrenceCount})`)).join(",\n");
  const occurrenceValues = frozen.policies.flatMap((policy) => policy.occurrences.map((row) => `(${sql(policy.restrictionKind)},${row.sourceOrder},${sql(row.definitionHash)},${sql(row.rawValue)},${sql(row.sourceRowHash)})`)).join(",\n");
  return `SET NAMES utf8mb4;
START TRANSACTION;

CREATE TABLE IF NOT EXISTS asset_item_restriction_sets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  catalog_version VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  restriction_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_system VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_path VARCHAR(191) NOT NULL,
  source_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_row_count INT UNSIGNED NOT NULL,
  source_unique_count INT UNSIGNED NOT NULL,
  publication_status ENUM('SHADOW','PUBLISHED','RETIRED') NOT NULL DEFAULT 'SHADOW',
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_asset_item_restriction_set_version_kind (catalog_version,restriction_kind),
  KEY ix_asset_item_restriction_set_source (source_system,source_path,source_key,source_sha256),
  CONSTRAINT chk_asset_item_restriction_set_counts CHECK (source_row_count >= source_unique_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asset_item_restriction_definitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  restriction_set_id BIGINT UNSIGNED NOT NULL,
  definition_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name TEXT NOT NULL,
  canonical_item_id BIGINT UNSIGNED NULL,
  first_source_order INT UNSIGNED NOT NULL,
  occurrence_count INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_asset_item_restriction_definition (restriction_set_id,definition_hash),
  KEY ix_asset_item_restriction_definition_item (canonical_item_id),
  CONSTRAINT fk_asset_item_restriction_definition_set FOREIGN KEY (restriction_set_id) REFERENCES asset_item_restriction_sets(id) ON DELETE CASCADE,
  CONSTRAINT fk_asset_item_restriction_definition_item FOREIGN KEY (canonical_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT chk_asset_item_restriction_definition_count CHECK (occurrence_count > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asset_item_restriction_occurrences (
  restriction_set_id BIGINT UNSIGNED NOT NULL,
  source_order INT UNSIGNED NOT NULL,
  restriction_definition_id BIGINT UNSIGNED NOT NULL,
  raw_value TEXT NOT NULL,
  source_row_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (restriction_set_id,source_order),
  KEY ix_asset_item_restriction_occurrence_definition (restriction_definition_id),
  CONSTRAINT fk_asset_item_restriction_occurrence_set FOREIGN KEY (restriction_set_id) REFERENCES asset_item_restriction_sets(id) ON DELETE CASCADE,
  CONSTRAINT fk_asset_item_restriction_occurrence_definition FOREIGN KEY (restriction_definition_id) REFERENCES asset_item_restriction_definitions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO asset_item_restriction_sets
  (catalog_version,restriction_kind,source_system,source_path,source_key,source_sha256,source_row_count,source_unique_count,publication_status) VALUES
${setValues}
ON DUPLICATE KEY UPDATE catalog_version=VALUES(catalog_version);

CREATE TEMPORARY TABLE tmp_asset_item_restriction_definitions_418 (
  restriction_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  definition_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name TEXT NOT NULL,
  first_source_order INT UNSIGNED NOT NULL,
  occurrence_count INT UNSIGNED NOT NULL,
  PRIMARY KEY (restriction_kind,definition_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tmp_asset_item_restriction_definitions_418
  (restriction_kind,definition_hash,display_name,first_source_order,occurrence_count) VALUES
${definitionValues};

INSERT INTO asset_item_restriction_definitions
  (restriction_set_id,definition_hash,display_name,canonical_item_id,first_source_order,occurrence_count)
SELECT set_row.id,definition_row.definition_hash,definition_row.display_name,NULL,definition_row.first_source_order,definition_row.occurrence_count
FROM tmp_asset_item_restriction_definitions_418 definition_row
JOIN asset_item_restriction_sets set_row ON set_row.catalog_version=${sql(frozen.catalogVersion)} AND set_row.restriction_kind=definition_row.restriction_kind
ORDER BY definition_row.restriction_kind,definition_row.first_source_order
ON DUPLICATE KEY UPDATE definition_hash=VALUES(definition_hash);

CREATE TEMPORARY TABLE tmp_asset_item_restriction_occurrences_418 (
  restriction_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_order INT UNSIGNED NOT NULL,
  definition_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  raw_value TEXT NOT NULL,
  source_row_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (restriction_kind,source_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tmp_asset_item_restriction_occurrences_418
  (restriction_kind,source_order,definition_hash,raw_value,source_row_hash) VALUES
${occurrenceValues};

INSERT INTO asset_item_restriction_occurrences
  (restriction_set_id,source_order,restriction_definition_id,raw_value,source_row_hash)
SELECT set_row.id,occurrence_row.source_order,definition_row.id,occurrence_row.raw_value,occurrence_row.source_row_hash
FROM tmp_asset_item_restriction_occurrences_418 occurrence_row
JOIN asset_item_restriction_sets set_row ON set_row.catalog_version=${sql(frozen.catalogVersion)} AND set_row.restriction_kind=occurrence_row.restriction_kind
JOIN asset_item_restriction_definitions definition_row ON definition_row.restriction_set_id=set_row.id AND definition_row.definition_hash=occurrence_row.definition_hash
ORDER BY occurrence_row.restriction_kind,occurrence_row.source_order
ON DUPLICATE KEY UPDATE source_order=VALUES(source_order);

DROP TEMPORARY TABLE tmp_asset_item_restriction_occurrences_418;
DROP TEMPORARY TABLE tmp_asset_item_restriction_definitions_418;
COMMIT;
`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sql(value) {
  return `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}
