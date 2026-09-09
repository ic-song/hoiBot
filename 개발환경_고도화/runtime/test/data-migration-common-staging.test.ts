import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { assertCommonStagingDatabaseName, extractCommonStagingRecords, MariaCommonStagingRepository, type CommonStagingExtractionManifest } from "../src/data-migration/common-staging-extractor.js";

const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/data-migration-common-staging-v1.json", import.meta.url), "utf8")) as CommonStagingExtractionManifest;
const migration = readFileSync(new URL("../migrations/457_data_migration_common_staging.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../migrations/rollback/457_data_migration_common_staging.rollback.sql", import.meta.url), "utf8");
const contract = JSON.parse(readFileSync(new URL("../../migration-control/contracts/data-migration-common-staging.v1.json", import.meta.url), "utf8")) as { migration: string; rawProviderMigration: string; tables: Array<{ table: string; primaryKey: string; auditColumns: string[] }> };
const payload = Buffer.from(JSON.stringify({ member: { alpha: { name: "사용자-A", bag: { "다이아상자💎(/다이아상자오픈)": "2" } } }, capturedAt: "2026-09-03 15:30:00" }), "utf8");
const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

describe("data migration common staging contract", () => {
  it("uses specific CUID2 PKs, matching FK names and mandatory audit columns", () => {
    assert.equal(contract.migration, "457_data_migration_common_staging.sql");
    assert.equal(contract.rawProviderMigration, "442_data_migration_raw_landing.sql");
    assert.deepEqual(contract.tables.map((table) => table.primaryKey), ["common_staging_run_id", "common_staging_record_id"]);
    for (const table of contract.tables) assert.deepEqual(table.auditColumns, ["INSERT_USER", "INSERT_TIME", "UPDATE_USER", "UPDATE_TIME"]);
    assert.doesNotMatch(migration, /^\s*id\s+/im);
    assert.match(migration, /common_staging_run_id CHAR\(8\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/g);
    assert.match(migration, /REFERENCES data_migration_common_staging_runs\(common_staging_run_id\)/);
    for (const audit of ["INSERT_USER VARCHAR(100)", "INSERT_TIME CHAR(19)", "UPDATE_USER VARCHAR(100)", "UPDATE_TIME CHAR(19)"]) assert.equal(migration.split(audit).length - 1, 2);
    assert.match(rollback, /DROP TABLE IF EXISTS data_migration_common_staging_records;[\s\S]*DROP TABLE IF EXISTS data_migration_common_staging_runs;/);
  });

  it("refuses operational database names before import or rollback", () => {
    assert.doesNotThrow(() => assertCommonStagingDatabaseName("hoibot_schema_design"));
    assert.doesNotThrow(() => assertCommonStagingDatabaseName("hoibot_rehearsal_object_db"));
    assert.throws(() => assertCommonStagingDatabaseName("hoibot_prod"), /OPERATIONAL_DATABASE_REFUSED/);
    assert.throws(() => assertCommonStagingDatabaseName("production"), /OPERATIONAL_DATABASE_REFUSED/);
  });

  it("extracts exact display-key payload through JSON Pointer and hashes owner identity", () => {
    assert.equal(sha(payload), fixture.entries[0]!.sourceContentSha256);
    const extracted = extractCommonStagingRecords(fixture, new Map([[fixture.entries[0]!.sourcePathSha256, payload]]));
    assert.match(extracted.extractionManifestSha256, /^[a-f0-9]{64}$/);
    assert.equal(extracted.records.length, 1);
    assert.deepEqual(extracted.records[0], {
      sourceSystem: "LEGACY_JSON",
      sourceNamespace: "member.json",
      sourcePathSha256: fixture.entries[0]!.sourcePathSha256,
      sourceContentSha256: fixture.entries[0]!.sourceContentSha256,
      logicalSourceName: "data/member.json",
      sourcePointer: "/member/alpha/bag/다이아상자💎(~1다이아상자오픈)",
      identityPointer: "/member/8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8/bag/다이아상자💎(~1다이아상자오픈)",
      sourceLocatorSha256: sha(["data/member.json", "/member/8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8/bag/다이아상자💎(~1다이아상자오픈)", "OWNERSHIP_QUANTITY", "0"].join("\0")),
      ownerLocatorSha256: sha("alpha"),
      occurrenceIndex: 0,
      projectionLocator: null,
      recordDomain: "INVENTORY",
      recordKind: "OWNERSHIP_QUANTITY",
      projectionStatus: "PROJECT",
      quarantineReason: null,
      quantityValue: "2",
      observedTime: "2026-09-03 15:30:00",
      payloadJson: "\"2\"",
      payloadFingerprint: sha(JSON.stringify("2"))
    });
  });

  it("fails closed for payload drift, invalid quantity and duplicate locators", () => {
    const path = fixture.entries[0]!.sourcePathSha256;
    assert.throws(() => extractCommonStagingRecords(fixture, new Map([[path, Buffer.from("{}")]])), /RAW_PAYLOAD_MISMATCH/);
    const negativePayload = Buffer.from(JSON.stringify({ member: { alpha: { name: "사용자-A", bag: { "다이아상자💎(/다이아상자오픈)": -1 } } }, capturedAt: "2026-09-03 15:30:00" }));
    const negative = structuredClone(fixture);
    negative.entries[0]!.sourceContentSha256 = sha(negativePayload);
    assert.throws(() => extractCommonStagingRecords(negative, new Map([[path, negativePayload]])), /QUANTITY_INVALID/);
    const duplicate = structuredClone(fixture);
    duplicate.entries[0]!.records[0]!.projectionLocator = "same-occurrence";
    duplicate.entries[0]!.records.push(structuredClone(duplicate.entries[0]!.records[0]!));
    assert.throws(() => extractCommonStagingRecords(duplicate, new Map([[path, payload]])), /DUPLICATE_SOURCE_LOCATOR/);
    const ignored = structuredClone(fixture);
    ignored.entries[0]!.disposition = "IGNORE";
    ignored.entries[0]!.records = [];
    ignored.entries[0]!.ignoreReason = "NOT_OBJECT_DOMAIN_INPUT";
    assert.equal(extractCommonStagingRecords(ignored, new Map([[path, payload]])).records.length, 0);
    const incomplete = structuredClone(fixture);
    incomplete.entries = [];
    assert.throws(() => extractCommonStagingRecords(incomplete, new Map()), /SOURCE_COVERAGE_EMPTY/);
    const invalidEscape = structuredClone(fixture);
    invalidEscape.entries[0]!.records[0]!.sourcePointer = "/member/~2";
    assert.throws(() => extractCommonStagingRecords(invalidEscape, new Map([[path, payload]])), /POINTER_ESCAPE_INVALID/);
    const nulDelimited = structuredClone(fixture);
    nulDelimited.entries[0]!.logicalSourceName = "data/member.json\0collision";
    assert.throws(() => extractCommonStagingRecords(nulDelimited, new Map([[path, payload]])), /LOGICAL_SOURCE_INVALID/);
    const invalidOwnerSegment = structuredClone(fixture);
    invalidOwnerSegment.entries[0]!.records[0]!.ownerPathSegmentIndex = 99;
    assert.throws(() => extractCommonStagingRecords(invalidOwnerSegment, new Map([[path, payload]])), /OWNER_PATH_SEGMENT_INVALID/);
    const invalidTimePayload = Buffer.from(JSON.stringify({ member: { alpha: { name: "사용자-A", bag: { "다이아상자💎(/다이아상자오픈)": "2" } } }, capturedAt: "2026-99-99 99:99:99" }));
    const invalidTime = structuredClone(fixture);
    invalidTime.entries[0]!.sourceContentSha256 = sha(invalidTimePayload);
    assert.throws(() => extractCommonStagingRecords(invalidTime, new Map([[path, invalidTimePayload]])), /OBSERVED_TIME_INVALID/);
  });
});

class ScriptedDatabase implements DatabaseClient {
  readonly writes: string[] = [];
  constructor(private readonly queryHandler: (sql: string, values: readonly unknown[]) => unknown) {}
  async ping(): Promise<void> {}
  async verifyRollback(): Promise<boolean> { return true; }
  async query<T>(sql: string, values: readonly unknown[] = []): Promise<T> { return this.queryHandler(sql, values) as T; }
  async execute(sql: string, _values: readonly unknown[] = []): Promise<DatabaseWriteResult> { this.writes.push(sql); return { affectedRows: 1n, insertId: 0n }; }
  async withTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> { return work(this); }
  async close(): Promise<void> {}
}

describe("MariaCommonStagingRepository", () => {
  it("commits a fresh extraction atomically and replays the same input with zero writes", async () => {
    const path = fixture.entries[0]!.sourcePathSha256;
    const extracted = extractCommonStagingRecords(fixture, new Map([[path, payload]]));
    const storedRows = extracted.records.map((record) => ({
      source_system: record.sourceSystem, source_namespace: record.sourceNamespace,
      source_path_sha256: record.sourcePathSha256, source_content_sha256: record.sourceContentSha256,
      logical_source_name: record.logicalSourceName, source_pointer: record.sourcePointer,
      identity_pointer: record.identityPointer, source_locator_sha256: record.sourceLocatorSha256,
      owner_locator_sha256: record.ownerLocatorSha256, occurrence_index: record.occurrenceIndex,
      projection_locator: record.projectionLocator, record_domain: record.recordDomain,
      record_kind: record.recordKind, projection_status: record.projectionStatus,
      quarantine_reason: record.quarantineReason, quantity_value: record.quantityValue,
      observed_time: record.observedTime, payload_json: record.payloadJson,
      payload_fingerprint: record.payloadFingerprint
    }));
    let storedRunId: string | undefined;
    const first = new ScriptedDatabase((sql, values) => {
      if (sql.includes("FROM data_migration_raw_runs")) return [{ id: 7n, snapshot_manifest_sha256: fixture.snapshotManifestSha256, bundle_sha256: fixture.rawBundleSha256, expected_file_count: 1, expected_total_bytes: BigInt(payload.byteLength), run_status: "COMPLETE" }];
      if (sql.includes("FROM data_migration_raw_files")) return [{ source_content_sha256: sha(payload), payload, payload_sha256: sha(payload) }];
      if (sql.includes("FROM data_migration_common_staging_runs")) return [];
      if (sql.includes("FROM data_migration_common_staging_records")) {
        storedRunId = String(values[0]);
        return storedRows;
      }
      throw new Error(`UNEXPECTED_QUERY:${sql}`);
    });
    const imported = await new MariaCommonStagingRepository(first).extractAndStage(fixture);
    assert.equal(imported.insertedRecords, 1);
    assert.equal(imported.replayed, false);
    assert.equal(imported.commonStagingRunId, storedRunId);
    assert.equal(first.writes.filter((sql) => sql.startsWith("INSERT INTO data_migration_common_staging_")).length, 2);
    assert.equal(first.writes.filter((sql) => sql.startsWith("UPDATE data_migration_common_staging_runs")).length, 1);

    const replay = new ScriptedDatabase((sql) => {
      if (sql.includes("FROM data_migration_raw_runs")) return [{ id: 7n, snapshot_manifest_sha256: fixture.snapshotManifestSha256, bundle_sha256: fixture.rawBundleSha256, expected_file_count: 1, expected_total_bytes: BigInt(payload.byteLength), run_status: "COMPLETE" }];
      if (sql.includes("FROM data_migration_raw_files")) return [{ source_content_sha256: sha(payload), payload, payload_sha256: sha(payload) }];
      if (sql.includes("FROM data_migration_common_staging_runs")) return [{ common_staging_run_id: imported.commonStagingRunId, snapshot_manifest_sha256: fixture.snapshotManifestSha256, staging_sha256: extracted.stagingSha256, expected_file_count: 1, expected_total_bytes: BigInt(payload.byteLength), expected_record_count: 1, projected_file_count: 1, ignored_file_count: 0, run_status: "COMPLETE" }];
      if (sql.includes("FROM data_migration_common_staging_records")) return storedRows;
      throw new Error(`UNEXPECTED_QUERY:${sql}`);
    });
    const replayed = await new MariaCommonStagingRepository(replay).extractAndStage(fixture);
    assert.deepEqual(replayed, { commonStagingRunId: imported.commonStagingRunId, insertedRecords: 0, totalRecords: 1, replayed: true });
    assert.equal(replay.writes.length, 0);

    const tampered = new ScriptedDatabase((sql) => {
      if (sql.includes("FROM data_migration_raw_runs")) return [{ id: 7n, snapshot_manifest_sha256: fixture.snapshotManifestSha256, bundle_sha256: fixture.rawBundleSha256, expected_file_count: 1, expected_total_bytes: BigInt(payload.byteLength), run_status: "COMPLETE" }];
      if (sql.includes("FROM data_migration_raw_files")) return [{ source_content_sha256: sha(payload), payload, payload_sha256: sha(payload) }];
      if (sql.includes("FROM data_migration_common_staging_runs")) return [{ common_staging_run_id: imported.commonStagingRunId, snapshot_manifest_sha256: fixture.snapshotManifestSha256, staging_sha256: extracted.stagingSha256, expected_file_count: 1, expected_total_bytes: BigInt(payload.byteLength), expected_record_count: 1, projected_file_count: 1, ignored_file_count: 0, run_status: "COMPLETE" }];
      if (sql.includes("FROM data_migration_common_staging_records")) return [{ ...storedRows[0], owner_locator_sha256: "0".repeat(64) }];
      throw new Error(`UNEXPECTED_QUERY:${sql}`);
    });
    await assert.rejects(() => new MariaCommonStagingRepository(tampered).extractAndStage(fixture), /DB_PARITY_MISMATCH/);
    assert.equal(tampered.writes.length, 0);
  });
});
