import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { validateObjectDataModelContract, type ObjectDataModelContract } from "../src/catalog/object-data-model-contract.js";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { calculateRawLandingBundleSha256, MariaRawLandingRepository, type RawLandingBundleManifest } from "../src/data-migration/maria-raw-landing-repository.js";
import { createHash } from "node:crypto";

const migrationPath = resolve("migrations/476_data_migration_raw_landing_standard_correction.sql");
const rollbackPath = resolve("migrations/rollback/476_data_migration_raw_landing_standard_correction.rollback.sql");
const contracts = resolve("../migration-control/contracts");
const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

describe("RAW Landing migration442 standard correction", () => {
  it("registers descriptive CUID8 PK/FK and KST audit4 without changing migration442", async () => {
    const [migration, baseline, modelText] = await Promise.all([
      readFile(migrationPath, "utf8"),
      readFile(resolve("migrations/442_data_migration_raw_landing.sql"), "utf8"),
      readFile(resolve(contracts, "object-data-model-raw-landing-correction.v1.json"), "utf8")
    ]);
    assert.match(baseline, /id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT/);
    assert.match(migration, /raw_landing_run_id CHAR\(8\) CHARACTER SET ascii COLLATE ascii_bin/);
    assert.match(migration, /raw_landing_file_id CHAR\(8\) CHARACTER SET ascii COLLATE ascii_bin/);
    assert.match(migration, /FOREIGN KEY \(raw_landing_run_id\)[\s\S]*REFERENCES data_migration_raw_runs\(raw_landing_run_id\)/);
    assert.match(migration, /CHANGE COLUMN id legacy_raw_run_sequence/);
    assert.match(migration, /legacy_created_at_utc DATETIME\(3\)/);
    assert.match(migration, /legacy_completed_at_utc DATETIME\(3\)/);
    assert.match(migration, /legacy_imported_at_utc DATETIME\(3\)/);
    assert.match(migration, /DROP COLUMN run_id/);
    assert.match(migration, /INSERT_USER VARCHAR\(100\)/);
    assert.match(migration, /INSERT_TIME CHAR\(19\)/);
    const model = JSON.parse(modelText) as ObjectDataModelContract;
    assert.doesNotThrow(() => validateObjectDataModelContract(model));
  });

  it("declares lossless backfill, Common Staging handoff and guarded rollback", async () => {
    const [amendmentText, planText, rollback, rollbackMirror] = await Promise.all([
      readFile(resolve(contracts, "data-migration-raw-landing-amendment.v1.json"), "utf8"),
      readFile(resolve(contracts, "data-migration-raw-landing-schema-plan.v1.json"), "utf8"),
      readFile(rollbackPath, "utf8"),
      readFile(resolve("../migration-control/rollback/476_data_migration_raw_landing_standard_correction.sql"), "utf8")
    ]);
    const amendment = JSON.parse(amendmentText) as { baselineMigration: string; correctionMigration: string; losslessBackfill: string[]; runtimeConsumers: string[] };
    const plan = JSON.parse(planText) as { tables: Array<{ primaryKey: string }>; commonStagingHandoff: string };
    assert.equal(amendment.baselineMigration, "442_data_migration_raw_landing.sql");
    assert.equal(amendment.correctionMigration, "476_data_migration_raw_landing_standard_correction.sql");
    assert.ok(amendment.losslessBackfill.includes("payload SHA-256"));
    assert.ok(amendment.runtimeConsumers.includes("common-staging-extractor.ts"));
    assert.deepEqual(plan.tables.map((table) => table.primaryKey), ["raw_landing_run_id", "raw_landing_file_id"]);
    assert.match(plan.commonStagingHandoff, /raw_landing_run_id/);
    assert.match(rollback, /legacy_raw_run_sequence IS NULL/);
    assert.match(rollback, /legacy_raw_run_sequence IS NOT NULL AND legacy_created_at_utc IS NULL/);
    assert.match(rollback, /legacy_raw_run_sequence IS NOT NULL[\s\S]*legacy_imported_at_utc IS NULL/);
    assert.match(rollback, /imported_at = file_row\.legacy_imported_at_utc/);
    assert.match(rollback, /created_at = legacy_created_at_utc/);
    assert.match(rollback, /CHANGE COLUMN legacy_raw_run_sequence id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT/);
    assert.equal(sha256(rollbackMirror), sha256(rollback));
  });

  it("replays a COMPLETE bundle with exact parity and zero DML calls", async () => {
    const payload = Buffer.from("test", "utf8");
    const pathSha256 = sha256("synthetic.json");
    const contentSha256 = sha256(payload);
    const entry = { pathSha256, contentSha256, size: payload.byteLength, storageName: `${pathSha256}.bin` };
    const manifest: RawLandingBundleManifest = {
      format: "hoibot-raw-landing-bundle-v1",
      snapshotManifestSha256: sha256("snapshot"),
      fileCount: 1,
      totalBytes: payload.byteLength,
      bundleSha256: calculateRawLandingBundleSha256([entry]),
      entries: [entry]
    };
    const run = { raw_landing_run_id: "r1234567", snapshot_manifest_sha256: manifest.snapshotManifestSha256, bundle_sha256: manifest.bundleSha256, expected_file_count: 1, expected_total_bytes: 4n, run_status: "COMPLETE", raw_landing_completed_time: "2026-09-05 10:02:04" };
    let dmlCount = 0;
    const database: DatabaseClient & DatabaseTransaction = {
      ping: async () => undefined,
      verifyRollback: async () => true,
      close: async () => undefined,
      query: async <T>(sql: string): Promise<T> => {
        if (sql.includes("FROM data_migration_raw_runs")) return [run] as T;
        if (sql.includes("SHA2(payload,256)")) return [{ source_content_sha256: contentSha256, size_bytes: 4n, payload_sha256: contentSha256 }] as T;
        if (sql.includes("FROM data_migration_raw_files")) return [{ source_path_sha256: pathSha256, source_content_sha256: contentSha256, size_bytes: 4n }] as T;
        throw new Error(`UNEXPECTED_QUERY:${sql}`);
      },
      execute: async (): Promise<DatabaseWriteResult> => { dmlCount += 1; return { affectedRows: 0n, insertId: 0n }; },
      withTransaction: async <T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> => work(database)
    };
    const result = await new MariaRawLandingRepository(database).importBundle(manifest, async () => payload);
    assert.equal(result.replayed, true);
    assert.equal(result.insertedFiles, 0);
    assert.equal(result.runId, run.raw_landing_run_id);
    assert.equal(dmlCount, 0);
  });
});
