import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sourceRevision = "5925b83b1dbfb78ef583354604e112b9430003f3";
const baselineRevision = "dd2b63f315d72a445ab4cd55f13c90dc5ae0ccd8";
const sourcePath = "data/petExploreData.json";
const sourceGitSha256 = "5fd232c3840eb2a6b9628e703f505a9a1f98becd265c70b0914d524a3e4ba7f7";
const baselineGitSha256 = "bc0138e8eacf4f71dae37405f6fb51d8f0e7627937c40ea422a014c7b5db4add";
const catalogVersion = "ASSET-FREEZE-v2.438-pet-explore-notice-01";
const configKey = "notice.pet_explore";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturePath = path.join(repoRoot, "개발환경_고도화/migration-control/fixtures/synthetic-relational/pet-explore-notice-catalog-v2438.json");
const migrationPath = path.join(repoRoot, "개발환경_고도화/runtime/migrations/430_pet_explore_notice_catalog.sql");
const rollbackPath = path.join(repoRoot, "개발환경_고도화/migration-control/rollback/430_pet_explore_notice_catalog.sql");
const evidencePath = path.join(repoRoot, "개발환경_고도화/migration-control/evidence/pet-explore-notice-catalog/slice.json");

const approvedRaw = gitBlob(sourceRevision);
const baselineRaw = gitBlob(baselineRevision);
if (sha256(approvedRaw) !== sourceGitSha256) throw new Error("PET_EXPLORE_NOTICE_SOURCE_HASH_DRIFT");
if (sha256(baselineRaw) !== baselineGitSha256) throw new Error("PET_EXPLORE_NOTICE_BASELINE_HASH_DRIFT");
const approved = JSON.parse(approvedRaw.toString("utf8"));
const baseline = JSON.parse(baselineRaw.toString("utf8"));
if (typeof approved.notice !== "string" || approved.notice.length === 0) throw new Error("PET_EXPLORE_NOTICE_MISSING");
if (typeof baseline.notice !== "string") throw new Error("PET_EXPLORE_NOTICE_BASELINE_MISSING");
if (approved.notice === baseline.notice) throw new Error("PET_EXPLORE_NOTICE_DELTA_MISSING");

const notice = {
  configKey,
  value: approved.notice,
  valueSha256: sha256(Buffer.from(approved.notice, "utf8")),
  utf16Length: approved.notice.length,
  utf8Bytes: Buffer.byteLength(approved.notice, "utf8"),
  lineCount: approved.notice.split("\n").length
};
const fixture = {
  sliceId: "SL-ASSET-PET-EXPLORE-NOTICE-CATALOG-01",
  catalogVersion,
  sourceRevision,
  baselineRevision,
  sourcePath,
  sourceGitSha256,
  baselineGitSha256,
  baselineNotice: baseline.notice,
  notice,
  providerBinding: {
    setCode: "operation_notices",
    headTable: "operation_notice_heads",
    configurationTable: "configuration_values",
    mutationScope: "operation.notice.mutate",
    mode: "EXISTING_PROVIDER_DEPENDENCY"
  },
  counts: { noticeValues: 1, newProviders: 0, changedConsumers: 0 }
};
if (notice.utf16Length !== 66 || notice.utf8Bytes !== 108 || notice.lineCount !== 3 || notice.valueSha256 !== "502c02bb0a67cee3b81a29ea939f069ef5b7e2527f5c7a925ec9461917fbfeb0") {
  throw new Error(`PET_EXPLORE_NOTICE_PARITY_DRIFT:${JSON.stringify(notice)}`);
}

for (const target of [fixturePath, migrationPath, rollbackPath, evidencePath]) fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
fs.writeFileSync(migrationPath, buildMigration(fixture), "utf8");
fs.writeFileSync(rollbackPath, buildRollback(), "utf8");
fs.writeFileSync(evidencePath, `${JSON.stringify({
  sliceId: fixture.sliceId,
  catalogVersion,
  sourceRevision,
  baselineRevision,
  sourcePath,
  sourceGitSha256,
  baselineGitSha256,
  notice: { configKey, valueSha256: notice.valueSha256, utf16Length: notice.utf16Length, utf8Bytes: notice.utf8Bytes, lineCount: notice.lineCount },
  providerBinding: fixture.providerBinding,
  carryForward: ["SL-OPERATION-NOTICE-MUTATE Gate1~7", "SL-PET-EXPLORE-GUILD-RAID-EVENT-CONTROL-01 Gate1~7"],
  scope: { providerChanged: false, consumerChanged: false, operationalDataTouched: false, gate8: false }
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ catalogVersion, ...notice, ...fixture.counts }));

function buildMigration(frozen) {
  return `SET NAMES utf8mb4;\r\nSTART TRANSACTION;\r\n\r\nCREATE TABLE IF NOT EXISTS pet_explore_notice_catalog_versions (\r\n  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,\r\n  catalog_version VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,\r\n  source_revision CHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,\r\n  source_path VARCHAR(191) NOT NULL,\r\n  source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,\r\n  configuration_set_id BIGINT UNSIGNED NOT NULL,\r\n  config_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,\r\n  notice_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,\r\n  utf16_length INT UNSIGNED NOT NULL,\r\n  utf8_bytes INT UNSIGNED NOT NULL,\r\n  line_count INT UNSIGNED NOT NULL,\r\n  mutation_scope VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,\r\n  binding_mode VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,\r\n  publication_status ENUM('SHADOW','PUBLISHED','RETIRED') NOT NULL DEFAULT 'SHADOW',\r\n  active BOOLEAN NOT NULL DEFAULT FALSE,\r\n  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),\r\n  PRIMARY KEY (id),\r\n  UNIQUE KEY uq_pet_explore_notice_catalog_version (catalog_version),\r\n  UNIQUE KEY uq_pet_explore_notice_config_binding (configuration_set_id,config_key),\r\n  CONSTRAINT fk_pet_explore_notice_configuration_set FOREIGN KEY (configuration_set_id) REFERENCES configuration_sets(id) ON DELETE RESTRICT,\r\n  CONSTRAINT chk_pet_explore_notice_lengths CHECK (utf16_length=66 AND utf8_bytes=108 AND line_count=3),\r\n  CONSTRAINT chk_pet_explore_notice_binding CHECK (config_key='notice.pet_explore' AND mutation_scope='operation.notice.mutate' AND binding_mode='EXISTING_PROVIDER_DEPENDENCY')\r\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\r\n\r\nSET @pet_explore_notice_set_id_430=(SELECT active_configuration_set_id FROM operation_notice_heads WHERE set_code='operation_notices' LIMIT 1);\r\nINSERT INTO configuration_values(configuration_set_id,config_key,value_type,string_value,validation_json)\r\nSELECT @pet_explore_notice_set_id_430,${sql(configKey)},'string',${sql(frozen.notice.value)},JSON_OBJECT('domain','pet_explore','catalogVersion',${sql(catalogVersion)},'sha256',${sql(frozen.notice.valueSha256)},'maxLength',1000)\r\nWHERE @pet_explore_notice_set_id_430 IS NOT NULL\r\nON DUPLICATE KEY UPDATE config_key=VALUES(config_key);\r\n\r\nINSERT INTO pet_explore_notice_catalog_versions(catalog_version,source_revision,source_path,source_sha256,configuration_set_id,config_key,notice_sha256,utf16_length,utf8_bytes,line_count,mutation_scope,binding_mode,publication_status,active)\r\nSELECT ${sql(catalogVersion)},${sql(sourceRevision)},${sql(sourcePath)},${sql(sourceGitSha256)},@pet_explore_notice_set_id_430,${sql(configKey)},${sql(frozen.notice.valueSha256)},${frozen.notice.utf16Length},${frozen.notice.utf8Bytes},${frozen.notice.lineCount},'operation.notice.mutate','EXISTING_PROVIDER_DEPENDENCY','SHADOW',TRUE\r\nFROM configuration_values value_row\r\nWHERE value_row.configuration_set_id=@pet_explore_notice_set_id_430 AND value_row.config_key=${sql(configKey)} AND value_row.value_type='string' AND BINARY value_row.string_value=BINARY ${sql(frozen.notice.value)}\r\nON DUPLICATE KEY UPDATE catalog_version=VALUES(catalog_version);\r\n\r\nSET @pet_explore_notice_catalog_id_430=(SELECT id FROM pet_explore_notice_catalog_versions WHERE catalog_version=${sql(catalogVersion)} LIMIT 1);\r\nUPDATE pet_explore_notice_catalog_versions SET active=(id=@pet_explore_notice_catalog_id_430) WHERE active=TRUE OR id=@pet_explore_notice_catalog_id_430;\r\nCOMMIT;\r\n`;
}

function buildRollback() {
  return `SET NAMES utf8mb4;\r\nSTART TRANSACTION;\r\nSET @pet_explore_notice_set_id_430=(SELECT configuration_set_id FROM pet_explore_notice_catalog_versions WHERE catalog_version=${sql(catalogVersion)} LIMIT 1);\r\nDELETE FROM pet_explore_notice_catalog_versions WHERE catalog_version=${sql(catalogVersion)};\r\nDELETE FROM configuration_values WHERE configuration_set_id=@pet_explore_notice_set_id_430 AND config_key=${sql(configKey)};\r\nCOMMIT;\r\n`;
}

function gitBlob(revision) {
  return execFileSync("git", ["cat-file", "blob", `${revision}:${sourcePath}`], { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 });
}
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function sql(value) { return `'${String(value).replaceAll("'", "''")}'`; }
