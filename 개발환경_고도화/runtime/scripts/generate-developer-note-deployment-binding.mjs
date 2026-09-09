import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sourceRevision = "5925b83b1dbfb78ef583354604e112b9430003f3";
const sourcePath = "data/hoiBotChangeLog.json";
const sourceGitObjectSha256 = "f8b81bc64654acef926dfec92a00968937df9d8397a5463cfd70d37427b0e7f9";
const mainGitObjectSha256 = "a6527cde8df4e413e3296da976b89a95f49101dfc0f5c226e822a17e91b5fb07";
const catalogVersion = "ASSET-FREEZE-v2.438-developer-note-deployment-01";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturePath = path.join(repoRoot, "개발환경_고도화/migration-control/fixtures/synthetic-relational/developer-note-deployment-binding-v1.json");
const migrationPath = path.join(repoRoot, "개발환경_고도화/runtime/migrations/422_developer_note_deployment_binding.sql");
const rollbackPath = path.join(repoRoot, "개발환경_고도화/migration-control/rollback/422_developer_note_deployment_binding.sql");
const evidencePath = path.join(repoRoot, "개발환경_고도화/migration-control/evidence/developer-note-deployment-binding/slice.json");

const sourceRaw = execFileSync("git", ["cat-file", "blob", `${sourceRevision}:${sourcePath}`], { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 });
const mainRaw = execFileSync("git", ["cat-file", "blob", `${sourceRevision}:main.js`], { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 });
if (sha256(sourceRaw) !== sourceGitObjectSha256) throw new Error("DEVELOPER_NOTE_SOURCE_HASH_DRIFT");
if (sha256(mainRaw) !== mainGitObjectSha256) throw new Error("DEVELOPER_NOTE_MAIN_HASH_DRIFT");
const source = JSON.parse(sourceRaw.toString("utf8"));
const versionMatch = mainRaw.toString("utf8").match(/^const HoiBotVersion = "([^"]+)";/m);
if (versionMatch === null) throw new Error("DEVELOPER_NOTE_DEPLOYED_VERSION_MISSING");
const deployedVersion = versionMatch[1];
if (!Array.isArray(source.entries)) throw new Error("DEVELOPER_NOTE_ENTRIES_MISSING");
const versions = new Set();
let changeCount = 0;
const entries = source.entries.map((entry, index) => {
  if (typeof entry.version !== "string" || !/^\d+\.\d{3}$/.test(entry.version) || typeof entry.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !Array.isArray(entry.changes) || entry.changes.length === 0 || entry.changes.some((change) => typeof change !== "string" || change === "")) {
    throw new Error(`DEVELOPER_NOTE_ROW_DRIFT:${index + 1}`);
  }
  if (versions.has(entry.version)) throw new Error(`DEVELOPER_NOTE_DUPLICATE_VERSION:${entry.version}`);
  versions.add(entry.version);
  changeCount += entry.changes.length;
  return { sourceOrder: index + 1, version: entry.version, releasedOn: entry.date, changes: entry.changes, contentHash: sha256(`${entry.version}\0${entry.date}\0${entry.changes.join("\0")}`) };
});
if (entries.length !== 325 || changeCount !== 499 || entries[0]?.version !== deployedVersion || deployedVersion !== "2.438") {
  throw new Error(`DEVELOPER_NOTE_DEPLOYMENT_PARITY_DRIFT:${entries.length}:${changeCount}:${entries[0]?.version}:${deployedVersion}`);
}

const fixture = { sliceId: "SL-ASSET-DEVELOPER-NOTE-DEPLOYMENT-BINDING-01", catalogVersion, sourceRevision, sourcePath, sourceGitObjectSha256, mainGitObjectSha256, deployedVersion, deploymentCommit: sourceRevision, counts: { entries: entries.length, changes: changeCount, duplicateVersions: 0 }, entries };
for (const target of [fixturePath, migrationPath, rollbackPath, evidencePath]) fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
fs.writeFileSync(migrationPath, buildMigration(fixture), "utf8");
fs.writeFileSync(rollbackPath, "START TRANSACTION;\nCREATE TEMPORARY TABLE tmp_developer_note_entry_ids_422 (id BIGINT UNSIGNED NOT NULL PRIMARY KEY) ENGINE=InnoDB;\nINSERT INTO tmp_developer_note_entry_ids_422(id) SELECT binding.developer_note_entry_id FROM developer_note_deployment_entries binding JOIN developer_note_deployment_catalogs catalog ON catalog.id=binding.deployment_catalog_id WHERE catalog.catalog_version='ASSET-FREEZE-v2.438-developer-note-deployment-01';\nDROP TABLE IF EXISTS developer_note_deployment_entries;\nDELETE change_row FROM developer_note_changes change_row JOIN tmp_developer_note_entry_ids_422 target ON target.id=change_row.entry_id;\nDELETE entry FROM developer_note_entries entry JOIN tmp_developer_note_entry_ids_422 target ON target.id=entry.id;\nDROP TABLE IF EXISTS developer_note_deployment_catalogs;\nDROP TEMPORARY TABLE tmp_developer_note_entry_ids_422;\nCOMMIT;\n", "utf8");
fs.writeFileSync(evidencePath, `${JSON.stringify({ sliceId: fixture.sliceId, catalogVersion, sourceRevision, sourceGitObjectSha256, mainGitObjectSha256, deployedVersion, deploymentCommit: sourceRevision, counts: fixture.counts, invariant: "latest developer-note version equals deployed HoiBotVersion", scope: { readConsumerChanged: false, productionReflectionPerformed: false, operationalDataTouched: false, gate8: false } }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ catalogVersion, deployedVersion, ...fixture.counts }));

function buildMigration(frozen) {
  const entryValues = frozen.entries.map((entry) => `(${sql(entry.version)},${sql(entry.releasedOn)},${entry.sourceOrder},${sql(entry.contentHash)})`).join(",\n");
  const changeValues = frozen.entries.flatMap((entry) => entry.changes.map((change, index) => `(${sql(entry.version)},${sql(entry.releasedOn)},${index},${sql(change)})`)).join(",\n");
  return `SET NAMES utf8mb4;
START TRANSACTION;

CREATE TABLE IF NOT EXISTS developer_note_deployment_catalogs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  catalog_version VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_revision CHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_path VARCHAR(191) NOT NULL,
  source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  main_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entry_count INT UNSIGNED NOT NULL,
  change_count INT UNSIGNED NOT NULL,
  latest_note_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deployed_bot_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deployment_commit CHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  publication_status ENUM('SHADOW','PUBLISHED','RETIRED') NOT NULL DEFAULT 'SHADOW',
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_developer_note_deployment_catalog_version (catalog_version),
  CONSTRAINT chk_developer_note_deployment_counts CHECK (entry_count=325 AND change_count=499),
  CONSTRAINT chk_developer_note_deployment_version CHECK (latest_note_version=deployed_bot_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS developer_note_deployment_entries (
  deployment_catalog_id BIGINT UNSIGNED NOT NULL,
  source_order INT UNSIGNED NOT NULL,
  developer_note_entry_id BIGINT UNSIGNED NOT NULL,
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (deployment_catalog_id,source_order),
  UNIQUE KEY uq_developer_note_deployment_entry (deployment_catalog_id,developer_note_entry_id),
  CONSTRAINT fk_developer_note_deployment_entry_catalog FOREIGN KEY (deployment_catalog_id) REFERENCES developer_note_deployment_catalogs(id) ON DELETE CASCADE,
  CONSTRAINT fk_developer_note_deployment_entry_note FOREIGN KEY (developer_note_entry_id) REFERENCES developer_note_entries(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TEMPORARY TABLE tmp_developer_note_entries_422 (
  version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  released_on DATE NOT NULL,
  source_order INT UNSIGNED NOT NULL,
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (source_order), UNIQUE KEY uq_tmp_developer_note_version (version)
) ENGINE=InnoDB;
INSERT INTO tmp_developer_note_entries_422(version,released_on,source_order,content_hash) VALUES
${entryValues};

INSERT INTO developer_note_entries(version,released_on,entry_order,active)
SELECT version,released_on,source_order,TRUE FROM tmp_developer_note_entries_422 ORDER BY source_order
ON DUPLICATE KEY UPDATE version=VALUES(version);

CREATE TEMPORARY TABLE tmp_developer_note_changes_422 (
  version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  released_on DATE NOT NULL,
  change_index INT UNSIGNED NOT NULL,
  change_text TEXT NOT NULL,
  PRIMARY KEY (version,released_on,change_index)
) ENGINE=InnoDB;
INSERT INTO tmp_developer_note_changes_422(version,released_on,change_index,change_text) VALUES
${changeValues};
INSERT INTO developer_note_changes(entry_id,change_index,change_text)
SELECT entry.id,change_row.change_index,change_row.change_text
FROM tmp_developer_note_changes_422 change_row
JOIN developer_note_entries entry ON entry.version=change_row.version AND entry.released_on=change_row.released_on
ON DUPLICATE KEY UPDATE change_index=VALUES(change_index);

INSERT INTO developer_note_deployment_catalogs
  (catalog_version,source_revision,source_path,source_sha256,main_sha256,entry_count,change_count,latest_note_version,deployed_bot_version,deployment_commit,publication_status)
VALUES (${sql(frozen.catalogVersion)},${sql(frozen.sourceRevision)},${sql(frozen.sourcePath)},${sql(frozen.sourceGitObjectSha256)},${sql(frozen.mainGitObjectSha256)},325,499,${sql(frozen.deployedVersion)},${sql(frozen.deployedVersion)},${sql(frozen.deploymentCommit)},'SHADOW')
ON DUPLICATE KEY UPDATE catalog_version=VALUES(catalog_version);

INSERT INTO developer_note_deployment_entries(deployment_catalog_id,source_order,developer_note_entry_id,content_hash)
SELECT catalog.id,row_data.source_order,entry.id,row_data.content_hash
FROM tmp_developer_note_entries_422 row_data
JOIN developer_note_entries entry ON entry.version=row_data.version AND entry.released_on=row_data.released_on AND entry.entry_order=row_data.source_order
JOIN developer_note_deployment_catalogs catalog ON catalog.catalog_version=${sql(frozen.catalogVersion)}
ORDER BY row_data.source_order
ON DUPLICATE KEY UPDATE source_order=VALUES(source_order);

DROP TEMPORARY TABLE tmp_developer_note_changes_422;
DROP TEMPORARY TABLE tmp_developer_note_entries_422;
COMMIT;
`;
}

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function sql(value) { return `'${String(value).replaceAll("'", "''")}'`; }
