import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sourceRevision = "5925b83b1dbfb78ef583354604e112b9430003f3";
const sourcePath = "data/miniPetCollectionInfo.json";
const sourceSha256 = "3dadafd107bb82480d6d5218f98af2a31d0037af7c15b5fecaf8d3c62b9a4e39";
const sourceGitObjectSha256 = "9d2d94abe3bfbbf0276f74e7ea2ffd2fb6242ba8a71b2a5af586d94cf4fdea2e";
const catalogVersion = "ASSET-FREEZE-v2.435-mini-pet-collection-reward-01";
const rewardTarget = {
  definitionCode: "pet_food",
  objectKey: "item.direct_bag.3076ae479a9eb44e",
  displayName: "펫먹이🍼",
  ownershipModel: "STACK"
};
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturePath = path.join(repoRoot, "개발환경_고도화/migration-control/fixtures/synthetic-relational/mini-pet-collection-reward-catalog-v1.json");
const migrationPath = path.join(repoRoot, "개발환경_고도화/runtime/migrations/420_mini_pet_collection_reward_catalog.sql");
const rollbackPath = path.join(repoRoot, "개발환경_고도화/migration-control/rollback/420_mini_pet_collection_reward_catalog.sql");
const evidencePath = path.join(repoRoot, "개발환경_고도화/migration-control/evidence/mini-pet-collection-reward-catalog/slice.json");

const raw = fs.readFileSync(path.join(repoRoot, sourcePath));
if (sha256(raw) !== sourceSha256) throw new Error(`MINI_PET_COLLECTION_REWARD_SOURCE_HASH_DRIFT:${sha256(raw)}`);
const gitRaw = execFileSync("git", ["show", `${sourceRevision}:${sourcePath}`], { cwd: repoRoot });
if (sha256(gitRaw) !== sourceGitObjectSha256) throw new Error(`MINI_PET_COLLECTION_REWARD_GIT_OBJECT_HASH_DRIFT:${sha256(gitRaw)}`);
if (JSON.stringify(JSON.parse(raw.toString("utf8"))) !== JSON.stringify(JSON.parse(gitRaw.toString("utf8")))) throw new Error("MINI_PET_COLLECTION_REWARD_SOURCE_SEMANTIC_DRIFT");
const source = JSON.parse(raw.toString("utf8"));
const gradeEntries = Object.entries(source.gradeReward);
const stageEntries = Object.entries(source.stageReward);
const titleEntries = Object.entries(source.titles);
if (gradeEntries.length !== 8 || stageEntries.length !== 100 || titleEntries.length !== 100) {
  throw new Error(`MINI_PET_COLLECTION_REWARD_COUNT_DRIFT:${gradeEntries.length}:${stageEntries.length}:${titleEntries.length}`);
}
if (stageEntries.some(([key], index) => Number(key) !== index + 1) || titleEntries.some(([key], index) => Number(key) !== index + 1)) {
  throw new Error("MINI_PET_COLLECTION_REWARD_STAGE_ORDER_DRIFT");
}

const occurrences = [];
for (let index = 0; index < gradeEntries.length; index++) {
  const [key, reward] = gradeEntries[index];
  occurrences.push(buildOccurrence("GRADE", key, occurrences.length + 1, index + 1, reward, null));
}
for (const [key, reward] of stageEntries) occurrences.push(buildOccurrence("STAGE", key, occurrences.length + 1, Number(key), reward, source.titles[key]));
if (occurrences.some((row) => row.rawItemDisplayName !== rewardTarget.displayName)) throw new Error("MINI_PET_COLLECTION_REWARD_TARGET_DISPLAY_DRIFT");

const fixture = {
  sliceId: "SL-ASSET-MINIPET-COLLECTION-REWARD-CATALOG-01",
  catalogVersion,
  sourceRevision,
  sourcePath,
  sourceSha256,
  sourceGitObjectSha256,
  rewardTarget,
  counts: { gradeRewards: gradeEntries.length, stageRewards: stageEntries.length, titleDefinitions: titleEntries.length, occurrences: occurrences.length },
  occurrences
};
fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
fs.mkdirSync(path.dirname(rollbackPath), { recursive: true });
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
fs.writeFileSync(migrationPath, buildMigration(fixture), "utf8");
fs.writeFileSync(rollbackPath, "START TRANSACTION;\nDROP TABLE IF EXISTS mini_pet_collection_reward_occurrences;\nDROP TABLE IF EXISTS mini_pet_collection_reward_catalogs;\nCOMMIT;\n", "utf8");
fs.writeFileSync(evidencePath, `${JSON.stringify({
  sliceId: fixture.sliceId,
  catalogVersion,
  sourceRevision,
  sourceSha256,
  sourceGitObjectSha256,
  counts: fixture.counts,
  canonicalRewardTarget: rewardTarget,
  titleBindingPolicy: "stable object source binding only; display-name-only matching forbidden",
  expectedBaselineTitleResolution: { resolved: 0, unresolved: 100, conflict: 0 },
  scope: { rewardConsumerCutover: false, titleDefinitionsMutated: false, ownershipChanged: false, operationalDataImported: false, gate8: false }
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ catalogVersion, sourceSha256, ...fixture.counts, rewardTarget }));

function buildOccurrence(sourceScope, sourceKey, globalSourceOrder, sourceOrder, reward, title) {
  if (reward === null || typeof reward !== "object" || reward.item !== rewardTarget.displayName || !Number.isSafeInteger(reward.count) || reward.count <= 0) {
    throw new Error(`MINI_PET_COLLECTION_REWARD_ROW_DRIFT:${sourceScope}:${sourceKey}`);
  }
  if (title !== null && (typeof title.name !== "string" || !Number.isSafeInteger(title.price) || title.price < 0)) {
    throw new Error(`MINI_PET_COLLECTION_TITLE_ROW_DRIFT:${sourceKey}`);
  }
  const displayIdentity = `${sourceScope}\0${sourceKey}\0${reward.item}\0${reward.count}\0${title?.name ?? ""}\0${title?.price ?? ""}`;
  return {
    sourceScope,
    sourceKey,
    globalSourceOrder,
    sourceOrder,
    rawItemDisplayName: reward.item,
    quantity: reward.count,
    titleDisplayName: title?.name ?? null,
    titlePrice: title?.price ?? null,
    displayIdentityHash: sha256(displayIdentity),
    sourceRowHash: sha256(`${globalSourceOrder}\0${displayIdentity}`)
  };
}

function buildMigration(frozen) {
  const occurrenceValues = frozen.occurrences.map((row) => `(${sql(row.sourceScope)},${sql(row.sourceKey)},${row.globalSourceOrder},${row.sourceOrder},${sql(row.rawItemDisplayName)},${row.quantity},${nullableSql(row.titleDisplayName)},${row.titlePrice ?? "NULL"},${sql(row.displayIdentityHash)},${sql(row.sourceRowHash)})`).join(",\n");
  return `SET NAMES utf8mb4;
START TRANSACTION;

CREATE TABLE IF NOT EXISTS mini_pet_collection_reward_catalogs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  catalog_version VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_system VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_path VARCHAR(191) NOT NULL,
  source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grade_reward_count INT UNSIGNED NOT NULL,
  stage_reward_count INT UNSIGNED NOT NULL,
  title_definition_count INT UNSIGNED NOT NULL,
  reward_item_id BIGINT UNSIGNED NOT NULL,
  reward_item_object_id BIGINT UNSIGNED NOT NULL,
  reward_item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reward_item_object_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reward_item_display_name VARCHAR(191) NOT NULL,
  ownership_model ENUM('STACK') NOT NULL,
  publication_status ENUM('SHADOW','PUBLISHED','RETIRED') NOT NULL DEFAULT 'SHADOW',
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mini_pet_collection_reward_catalog_version (catalog_version),
  CONSTRAINT fk_mini_pet_collection_reward_catalog_item FOREIGN KEY (reward_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_collection_reward_catalog_object FOREIGN KEY (reward_item_object_id) REFERENCES object_registry(id) ON DELETE RESTRICT,
  CONSTRAINT chk_mini_pet_collection_reward_catalog_counts CHECK (grade_reward_count=8 AND stage_reward_count=100 AND title_definition_count=100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mini_pet_collection_reward_occurrences (
  reward_catalog_id BIGINT UNSIGNED NOT NULL,
  global_source_order INT UNSIGNED NOT NULL,
  source_scope ENUM('GRADE','STAGE') NOT NULL,
  source_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  source_order INT UNSIGNED NOT NULL,
  raw_item_display_name VARCHAR(191) NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  title_display_name VARCHAR(191) NULL,
  title_price BIGINT UNSIGNED NULL,
  canonical_title_id BIGINT UNSIGNED NULL,
  title_resolution ENUM('NOT_APPLICABLE','RESOLVED','UNRESOLVED','CONFLICT') NOT NULL,
  display_identity_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_row_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (reward_catalog_id,global_source_order),
  UNIQUE KEY uq_mini_pet_collection_reward_source_order (reward_catalog_id,source_scope,source_order),
  UNIQUE KEY uq_mini_pet_collection_reward_source_key (reward_catalog_id,source_scope,source_key),
  KEY ix_mini_pet_collection_reward_title (canonical_title_id),
  CONSTRAINT fk_mini_pet_collection_reward_occurrence_catalog FOREIGN KEY (reward_catalog_id) REFERENCES mini_pet_collection_reward_catalogs(id) ON DELETE CASCADE,
  CONSTRAINT fk_mini_pet_collection_reward_occurrence_title FOREIGN KEY (canonical_title_id) REFERENCES title_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT chk_mini_pet_collection_reward_quantity CHECK (quantity>0),
  CONSTRAINT chk_mini_pet_collection_reward_title_resolution CHECK (
    (source_scope='GRADE' AND title_display_name IS NULL AND title_price IS NULL AND canonical_title_id IS NULL AND title_resolution='NOT_APPLICABLE') OR
    (source_scope='STAGE' AND title_display_name IS NOT NULL AND title_price IS NOT NULL AND
      ((title_resolution='RESOLVED' AND canonical_title_id IS NOT NULL) OR (title_resolution IN ('UNRESOLVED','CONFLICT') AND canonical_title_id IS NULL)))
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TEMPORARY TABLE tmp_mini_pet_collection_reward_binding_420 (
  reward_item_id BIGINT UNSIGNED NOT NULL,
  reward_item_object_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (reward_item_id,reward_item_object_id)
) ENGINE=InnoDB;

INSERT INTO tmp_mini_pet_collection_reward_binding_420(reward_item_id,reward_item_object_id)
SELECT definition_row.id,registry.id
FROM item_definitions definition_row
JOIN object_registry registry
  ON registry.object_key=${sql(frozen.rewardTarget.objectKey)}
 AND registry.object_type='ITEM'
 AND registry.active=TRUE
 AND JSON_UNQUOTE(JSON_EXTRACT(registry.metadata_json,'$.definitionCode'))=definition_row.code
JOIN object_source_bindings binding
  ON binding.object_id=registry.id
 AND binding.object_type='ITEM'
 AND binding.source_system='LEGACY_JS'
 AND binding.source_table='member.bag'
 AND binding.source_key=${sql(frozen.rewardTarget.displayName)}
WHERE definition_row.code=${sql(frozen.rewardTarget.definitionCode)}
  AND definition_row.display_name=${sql(frozen.rewardTarget.displayName)}
  AND definition_row.active=TRUE;

INSERT INTO mini_pet_collection_reward_catalogs
  (catalog_version,source_system,source_path,source_sha256,grade_reward_count,stage_reward_count,title_definition_count,reward_item_id,reward_item_object_id,reward_item_code,reward_item_object_key,reward_item_display_name,ownership_model,publication_status)
SELECT ${sql(frozen.catalogVersion)},'LEGACY_JSON',${sql(frozen.sourcePath)},${sql(frozen.sourceSha256)},8,100,100,binding.reward_item_id,binding.reward_item_object_id,${sql(frozen.rewardTarget.definitionCode)},${sql(frozen.rewardTarget.objectKey)},${sql(frozen.rewardTarget.displayName)},'STACK','SHADOW'
FROM tmp_mini_pet_collection_reward_binding_420 binding
ON DUPLICATE KEY UPDATE catalog_version=VALUES(catalog_version);

CREATE TEMPORARY TABLE tmp_mini_pet_collection_reward_occurrences_420 (
  source_scope ENUM('GRADE','STAGE') NOT NULL,
  source_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  global_source_order INT UNSIGNED NOT NULL,
  source_order INT UNSIGNED NOT NULL,
  raw_item_display_name VARCHAR(191) NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  title_display_name VARCHAR(191) NULL,
  title_price BIGINT UNSIGNED NULL,
  display_identity_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_row_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (global_source_order),
  UNIQUE KEY uq_tmp_mini_pet_collection_reward_key (source_scope,source_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tmp_mini_pet_collection_reward_occurrences_420
  (source_scope,source_key,global_source_order,source_order,raw_item_display_name,quantity,title_display_name,title_price,display_identity_hash,source_row_hash) VALUES
${occurrenceValues};

INSERT INTO mini_pet_collection_reward_occurrences
  (reward_catalog_id,global_source_order,source_scope,source_key,source_order,raw_item_display_name,quantity,title_display_name,title_price,canonical_title_id,title_resolution,display_identity_hash,source_row_hash)
SELECT catalog.id,row_data.global_source_order,row_data.source_scope,row_data.source_key,row_data.source_order,row_data.raw_item_display_name,row_data.quantity,row_data.title_display_name,row_data.title_price,
       CASE WHEN row_data.source_scope='STAGE' AND source_binding.id IS NOT NULL AND title_object.object_type IN ('TITLE','PET_TITLE') AND title_object.display_name=row_data.title_display_name AND title_definition.id IS NOT NULL THEN title_definition.id ELSE NULL END,
       CASE WHEN row_data.source_scope='GRADE' THEN 'NOT_APPLICABLE'
            WHEN source_binding.id IS NULL THEN 'UNRESOLVED'
            WHEN title_object.object_type IN ('TITLE','PET_TITLE') AND title_object.display_name=row_data.title_display_name AND title_definition.id IS NOT NULL THEN 'RESOLVED'
            ELSE 'CONFLICT' END,
       row_data.display_identity_hash,row_data.source_row_hash
FROM tmp_mini_pet_collection_reward_occurrences_420 row_data
JOIN mini_pet_collection_reward_catalogs catalog ON catalog.catalog_version=${sql(frozen.catalogVersion)}
LEFT JOIN object_source_bindings source_binding
  ON row_data.source_scope='STAGE'
 AND source_binding.source_system='LEGACY_JSON'
 AND source_binding.source_table='data/miniPetCollectionInfo.json#titles'
 AND source_binding.source_key=row_data.source_key
LEFT JOIN object_registry title_object ON title_object.id=source_binding.object_id
LEFT JOIN title_definitions title_definition ON title_definition.code=JSON_UNQUOTE(JSON_EXTRACT(title_object.metadata_json,'$.definitionCode'))
ORDER BY row_data.global_source_order
ON DUPLICATE KEY UPDATE global_source_order=VALUES(global_source_order);

DROP TEMPORARY TABLE tmp_mini_pet_collection_reward_occurrences_420;
DROP TEMPORARY TABLE tmp_mini_pet_collection_reward_binding_420;
COMMIT;
`;
}

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function sql(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function nullableSql(value) { return value === null ? "NULL" : sql(value); }
