import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sourceRevision = "5925b83b1dbfb78ef583354604e112b9430003f3";
const sourcePath = "data/packageInfo.json";
const sourceSha256 = "4d2072a8e829391cb2ad546ca9ba37d7081c677bdb9e2dedbc7e08e12697e7dc";
const catalogVersion = "ASSET-FREEZE-v2.438-package-typed-target-01";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturePath = path.join(repoRoot, "개발환경_고도화/migration-control/fixtures/synthetic-relational/package-typed-reward-target-catalog-v1.json");
const migrationPath = path.join(repoRoot, "개발환경_고도화/runtime/migrations/424_package_typed_reward_target_catalog.sql");
const rollbackPath = path.join(repoRoot, "개발환경_고도화/migration-control/rollback/424_package_typed_reward_target_catalog.sql");
const evidencePath = path.join(repoRoot, "개발환경_고도화/migration-control/evidence/package-typed-reward-target-catalog/slice.json");

// 기존 canonical item_definitions에서 코드와 표시명이 함께 검증된 STACK 대상만 고정합니다.
const canonicalStackCodes = new Map(Object.entries({
  "🌋 대균열 유도권(/대균열)": "guild_great_rift_guide", "🌌 균열 유도권(/균열)": "guild_rift_guide",
  "🌪️ 전쟁불안정 증폭권(/불안정)": "guild_instability_up", "🥕당근이세요?": "ITEM-RWD-044",
  "🚑 전쟁불안정 감소권(/안정)": "guild_instability_down", "1억포인트상자🪙(/포인트상자오픈)": "point_box_100m",
  "경찰과 도둑🚨(/삐뽀삐뽀)": "police_thief_ticket", "길드공헌훈장🌟(/길드공헌 숫자)": "guild_contribution_medal",
  "길드영지 부스터🔮(/길드부스터공헌 숫자)": "ITEM-GUILD-TERRITORY-BOOSTER", "다이아상자💎(/다이아상자오픈)": "ITEM-RWD-053",
  "돌멩이🪨": "ITEM-RWD-041", "땅문서📜": "land_document", "레이드타격대인장👑(+600👾)": "ITEM-RWD-043",
  "미니펫 강화석💫": "ITEM-RWD-018", "미니펫강화확률UP🐷(30%)": "ITEM-RWD-019", "미니펫뽑기🐹(/미니펫오픈)": "mini_pet_draw",
  "양념치킨🐔": "legacy-seasoned-chicken", "영지기습공격권🔥(40%)": "ITEM-TERRITORY-AMBUSH-40",
  "영지절대방어권🛡(50%)": "ITEM-TERRITORY-DEFENSE-50", "자동일퀘권📝": "auto_daily_quest_ticket",
  "자유시장회원권🏪": "free_market_membership", "잡템상자☠": "ITEM-RWD-TRASH-BOX", "전설의 돌맹이🗿": "ITEM-RWD-052",
  "치킨상자🐔": "ITEM-PACKAGE-CHICKEN-BOX", "캐슬코인🥇": "castle_coin", "티어 승급티켓🎟": "ITEM-RWD-022",
  "펜던트 강화석📿": "ITEM-PENDANT-ENHANCE-STONE", "펜던트귀속해제💎(/펜던트해제)": "ITEM-PENDANT-UNBIND-TICKET",
  "펜던트뽑기💎(/펜던트오픈)": "ITEM-PENDANT-DRAW-TICKET", "펫 강화석⭐": "pet_enhance_stone",
  "펫던전 입장권🌋": "ITEM-PET-DUNGEON-ENTRY-TICKET", "펫먹이🍼": "pet_food", "펫먹이특식🥡(/특식오픈)": "pet_food_special",
  "펫스윗홈인테리어샵🖼️(/샵오픈)": "ITEM-RWD-001", "펫스킬북 조각📙": "pet_skill_book_fragment",
  "펫스킬북📙(/펫스킬오픈)": "pet_skill_book", "핵꿀밤🥊(/펀치)": "punch_ticket", "호이베이스볼⚾️(/투수던집니다)": "ITEM-RWD-014",
  "홈뱃지 큐브💟": "ITEM-HOME-BADGE-CUBE", "홈뱃지뽑기🛡️(/홈뱃지오픈)": "ITEM-HOME-BADGE-GACHA-TICKET-1",
  "홈뱃지뽑기🛡️[2](/홈뱃지오픈2)": "ITEM-HOME-BADGE-GACHA-TICKET-2", "홈뱃지뽑기🛡️[3](/홈뱃지오픈3)": "ITEM-HOME-BADGE-GACHA-TICKET-3"
}));

const sourceRaw = execFileSync("git", ["cat-file", "blob", `${sourceRevision}:${sourcePath}`], { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 });
if (sha256(sourceRaw) !== sourceSha256) throw new Error("PACKAGE_TYPED_TARGET_SOURCE_HASH_DRIFT");
const source = JSON.parse(sourceRaw.toString("utf8"));
if (!Array.isArray(source)) throw new Error("PACKAGE_TYPED_TARGET_SOURCE_NOT_ARRAY");
const packageByInventoryKey = new Map();
const sourceIds = new Set();
const packages = source.map((row, index) => {
  if (typeof row.id !== "string" || sourceIds.has(row.id) || typeof row.name !== "string" || !Array.isArray(row.rewards)) throw new Error(`PACKAGE_TYPED_TARGET_PACKAGE_DRIFT:${index + 1}`);
  sourceIds.add(row.id);
  const inventoryKey = typeof row.itemName === "string" && row.itemName !== "" ? row.itemName : row.name;
  if (packageByInventoryKey.has(inventoryKey)) throw new Error(`PACKAGE_TYPED_TARGET_INVENTORY_KEY_DUPLICATE:${inventoryKey}`);
  packageByInventoryKey.set(inventoryKey, row.id);
  return { sourceOrder: index + 1, sourcePackageId: row.id, displayName: row.name, inventoryKey, description: String(row.desc ?? ""), enabled: row.enabled === true, legacyMaxUseOnce: Number(row.maxUseOnce), enforcementStatus: "INERT_METADATA", identityHash: sha256(`${row.id}\0${row.name}\0${inventoryKey}`) };
});

let globalSourceOrder = 0;
const occurrences = [];
for (let packageIndex = 0; packageIndex < source.length; packageIndex++) {
  const row = source[packageIndex];
  for (let rewardIndex = 0; rewardIndex < row.rewards.length; rewardIndex++) {
    const reward = row.rewards[rewardIndex];
    if (reward.type !== "item" || typeof reward.name !== "string" || !Number.isSafeInteger(reward.count) || reward.count <= 0) throw new Error(`PACKAGE_TYPED_TARGET_REWARD_DRIFT:${packageIndex + 1}:${rewardIndex + 1}`);
    const nestedPackageId = packageByInventoryKey.get(reward.name) ?? null;
    const targetType = nestedPackageId === null ? "STACK" : "PACKAGE";
    const canonicalItemCode = targetType === "STACK" ? canonicalStackCodes.get(reward.name) ?? null : null;
    globalSourceOrder++;
    occurrences.push({ globalSourceOrder, sourcePackageId: row.id, rewardOrder: rewardIndex + 1, rawType: reward.type, targetType, targetDisplayName: reward.name, quantity: reward.count, targetSourcePackageId: nestedPackageId, canonicalItemCode, canonicalPackageId: null, resolutionStatus: targetType === "PACKAGE" ? "SOURCE_RESOLVED_CANONICAL_GAP" : canonicalItemCode === null ? "GAP" : "RESOLVED", identityHash: sha256(`${row.id}\0${rewardIndex + 1}\0${reward.type}\0${reward.name}\0${reward.count}`) });
  }
}

const counts = {
  packages: packages.length, rewards: occurrences.length,
  stackRows: occurrences.filter((row) => row.targetType === "STACK").length,
  packageRows: occurrences.filter((row) => row.targetType === "PACKAGE").length,
  resolvedStackRows: occurrences.filter((row) => row.resolutionStatus === "RESOLVED").length,
  gapStackRows: occurrences.filter((row) => row.resolutionStatus === "GAP").length,
  uniqueStackTargets: new Set(occurrences.filter((row) => row.targetType === "STACK").map((row) => row.targetDisplayName)).size,
  uniquePackageTargets: new Set(occurrences.filter((row) => row.targetType === "PACKAGE").map((row) => row.targetDisplayName)).size
};
if (JSON.stringify(counts) !== JSON.stringify({ packages: 107, rewards: 557, stackRows: 513, packageRows: 44, resolvedStackRows: 467, gapStackRows: 46, uniqueStackTargets: 58, uniquePackageTargets: 21 })) throw new Error(`PACKAGE_TYPED_TARGET_PARITY_DRIFT:${JSON.stringify(counts)}`);
if (canonicalStackCodes.size !== 42 || packages.some((row) => ![100, 1000].includes(row.legacyMaxUseOnce))) throw new Error("PACKAGE_TYPED_TARGET_CLASSIFICATION_DRIFT");

const fixture = { sliceId: "SL-ASSET-PACKAGE-TYPED-REWARD-TARGET-CATALOG-01", catalogVersion, sourceRevision, sourcePath, sourceSha256, counts, invariants: { packageTargetRule: "exact source inventory key relationship", stackCanonicalRule: "frozen code plus exact display verification", maxUseOnce: "INERT_METADATA", consumerChanged: false }, packages, occurrences };
for (const target of [fixturePath, migrationPath, rollbackPath, evidencePath]) fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
fs.writeFileSync(migrationPath, buildMigration(fixture), "utf8");
fs.writeFileSync(rollbackPath, "SET NAMES utf8mb4;\nSTART TRANSACTION;\nDROP TABLE IF EXISTS asset_package_reward_target_occurrences;\nDROP TABLE IF EXISTS asset_package_source_definitions;\nDROP TABLE IF EXISTS asset_package_typed_target_catalogs;\nCOMMIT;\n", "utf8");
fs.writeFileSync(evidencePath, `${JSON.stringify({ sliceId: fixture.sliceId, catalogVersion, sourceRevision, sourceSha256, counts, classification: fixture.invariants, carryForward: ["package catalog Gate1~7", "package ownership Gate1~7", "canonical item adapter Gate1~7", "object catalog Gate1~7"], scope: { providerMode: "READ_ONLY", packageConsumerChanged: false, canonicalDefinitionsMutated: false, operationalDataTouched: false, gate8: false } }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ catalogVersion, ...counts }));

function buildMigration(frozen) {
  const packageValues = frozen.packages.map((row) => `(${row.sourceOrder},${sql(row.sourcePackageId)},${sql(row.displayName)},${sql(row.inventoryKey)},${sql(row.description)},${row.enabled ? 1 : 0},${row.legacyMaxUseOnce},'INERT_METADATA',${sql(row.identityHash)})`).join(",\n");
  const rewardValues = frozen.occurrences.map((row) => `(${row.globalSourceOrder},${sql(row.sourcePackageId)},${row.rewardOrder},${sql(row.rawType)},${sql(row.targetType)},${sql(row.targetDisplayName)},${row.quantity},${nullableSql(row.targetSourcePackageId)},${nullableSql(row.canonicalItemCode)},${nullableSql(row.canonicalPackageId)},${sql(row.resolutionStatus)},${sql(row.identityHash)})`).join(",\n");
  return `SET NAMES utf8mb4;
START TRANSACTION;

CREATE TABLE IF NOT EXISTS asset_package_typed_target_catalogs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  catalog_version VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_revision CHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_path VARCHAR(191) NOT NULL,
  source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  package_count INT UNSIGNED NOT NULL, reward_count INT UNSIGNED NOT NULL,
  stack_row_count INT UNSIGNED NOT NULL, package_row_count INT UNSIGNED NOT NULL,
  resolved_stack_row_count INT UNSIGNED NOT NULL, gap_stack_row_count INT UNSIGNED NOT NULL,
  publication_status ENUM('SHADOW','PUBLISHED','RETIRED') NOT NULL DEFAULT 'SHADOW',
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(id), UNIQUE KEY uq_asset_package_typed_target_version(catalog_version),
  CONSTRAINT chk_asset_package_typed_target_counts CHECK(package_count=107 AND reward_count=557 AND stack_row_count=513 AND package_row_count=44 AND resolved_stack_row_count=467 AND gap_stack_row_count=46)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asset_package_source_definitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, catalog_id BIGINT UNSIGNED NOT NULL,
  source_order INT UNSIGNED NOT NULL, source_package_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(255) NOT NULL, inventory_key VARCHAR(255) NOT NULL, description TEXT NOT NULL,
  enabled BOOLEAN NOT NULL, legacy_max_use_once INT UNSIGNED NOT NULL,
  enforcement_status ENUM('INERT_METADATA') NOT NULL DEFAULT 'INERT_METADATA', identity_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY(id), UNIQUE KEY uq_asset_package_source_order(catalog_id,source_order), UNIQUE KEY uq_asset_package_source_id(catalog_id,source_package_id), UNIQUE KEY uq_asset_package_source_key(catalog_id,inventory_key),
  CONSTRAINT fk_asset_package_source_catalog FOREIGN KEY(catalog_id) REFERENCES asset_package_typed_target_catalogs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asset_package_reward_target_occurrences (
  catalog_id BIGINT UNSIGNED NOT NULL, global_source_order INT UNSIGNED NOT NULL,
  source_package_definition_id BIGINT UNSIGNED NOT NULL, reward_order INT UNSIGNED NOT NULL,
  raw_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_type ENUM('STACK','PACKAGE') NOT NULL, target_display_name VARCHAR(255) NOT NULL, quantity BIGINT UNSIGNED NOT NULL,
  target_source_package_definition_id BIGINT UNSIGNED NULL, canonical_item_id BIGINT UNSIGNED NULL, canonical_package_id VARCHAR(64) NULL,
  resolution_status ENUM('RESOLVED','GAP','SOURCE_RESOLVED_CANONICAL_GAP') NOT NULL,
  identity_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY(catalog_id,global_source_order), UNIQUE KEY uq_asset_package_reward_order(source_package_definition_id,reward_order),
  CONSTRAINT fk_asset_package_reward_catalog FOREIGN KEY(catalog_id) REFERENCES asset_package_typed_target_catalogs(id) ON DELETE CASCADE,
  CONSTRAINT fk_asset_package_reward_source FOREIGN KEY(source_package_definition_id) REFERENCES asset_package_source_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_asset_package_reward_target_source FOREIGN KEY(target_source_package_definition_id) REFERENCES asset_package_source_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_asset_package_reward_item FOREIGN KEY(canonical_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_asset_package_reward_package FOREIGN KEY(canonical_package_id) REFERENCES package_catalog(package_id) ON DELETE RESTRICT,
  CONSTRAINT chk_asset_package_reward_target_shape CHECK((target_type='STACK' AND target_source_package_definition_id IS NULL AND canonical_package_id IS NULL) OR (target_type='PACKAGE' AND target_source_package_definition_id IS NOT NULL AND canonical_item_id IS NULL)),
  CONSTRAINT chk_asset_package_reward_resolution CHECK((resolution_status='RESOLVED' AND canonical_item_id IS NOT NULL) OR resolution_status='GAP' OR (resolution_status='SOURCE_RESOLVED_CANONICAL_GAP' AND target_source_package_definition_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TEMPORARY TABLE tmp_asset_package_source_424(source_order INT UNSIGNED NOT NULL PRIMARY KEY,source_package_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,display_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,inventory_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL UNIQUE,description TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,enabled BOOLEAN NOT NULL,legacy_max_use_once INT UNSIGNED NOT NULL,enforcement_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,identity_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL) ENGINE=InnoDB;
INSERT INTO tmp_asset_package_source_424 VALUES
${packageValues};

CREATE TEMPORARY TABLE tmp_asset_package_reward_424(global_source_order INT UNSIGNED NOT NULL PRIMARY KEY,source_package_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,reward_order INT UNSIGNED NOT NULL,raw_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,target_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,target_display_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,quantity BIGINT UNSIGNED NOT NULL,target_source_package_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,canonical_item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,canonical_package_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,resolution_status VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,identity_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL) ENGINE=InnoDB;
INSERT INTO tmp_asset_package_reward_424 VALUES
${rewardValues};

INSERT INTO asset_package_typed_target_catalogs(catalog_version,source_revision,source_path,source_sha256,package_count,reward_count,stack_row_count,package_row_count,resolved_stack_row_count,gap_stack_row_count,publication_status)
VALUES(${sql(frozen.catalogVersion)},${sql(frozen.sourceRevision)},${sql(frozen.sourcePath)},${sql(frozen.sourceSha256)},107,557,513,44,467,46,'SHADOW')
ON DUPLICATE KEY UPDATE catalog_version=VALUES(catalog_version);

INSERT INTO asset_package_source_definitions(catalog_id,source_order,source_package_id,display_name,inventory_key,description,enabled,legacy_max_use_once,enforcement_status,identity_hash)
SELECT catalog.id,row_data.source_order,row_data.source_package_id,row_data.display_name,row_data.inventory_key,row_data.description,row_data.enabled,row_data.legacy_max_use_once,'INERT_METADATA',row_data.identity_hash
FROM tmp_asset_package_source_424 row_data JOIN asset_package_typed_target_catalogs catalog ON catalog.catalog_version=${sql(frozen.catalogVersion)} ORDER BY row_data.source_order
ON DUPLICATE KEY UPDATE source_package_id=VALUES(source_package_id);

INSERT INTO asset_package_reward_target_occurrences(catalog_id,global_source_order,source_package_definition_id,reward_order,raw_type,target_type,target_display_name,quantity,target_source_package_definition_id,canonical_item_id,canonical_package_id,resolution_status,identity_hash)
SELECT catalog.id,row_data.global_source_order,source_definition.id,row_data.reward_order,row_data.raw_type,row_data.target_type,row_data.target_display_name,row_data.quantity,target_source_definition.id,canonical_item.id,row_data.canonical_package_id,row_data.resolution_status,row_data.identity_hash
FROM tmp_asset_package_reward_424 row_data
JOIN asset_package_typed_target_catalogs catalog ON catalog.catalog_version=${sql(frozen.catalogVersion)}
JOIN asset_package_source_definitions source_definition ON source_definition.catalog_id=catalog.id AND source_definition.source_package_id=row_data.source_package_id
LEFT JOIN asset_package_source_definitions target_source_definition ON target_source_definition.catalog_id=catalog.id AND target_source_definition.source_package_id=row_data.target_source_package_id
LEFT JOIN item_definitions canonical_item ON canonical_item.code=row_data.canonical_item_code AND canonical_item.display_name=row_data.target_display_name AND canonical_item.active=TRUE
ORDER BY row_data.global_source_order
ON DUPLICATE KEY UPDATE global_source_order=VALUES(global_source_order);

DROP TEMPORARY TABLE tmp_asset_package_reward_424;
DROP TEMPORARY TABLE tmp_asset_package_source_424;
COMMIT;
`;
}

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function sql(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function nullableSql(value) { return value === null ? "NULL" : sql(value); }
