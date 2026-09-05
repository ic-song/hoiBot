import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { assertCommonStagingDatabaseName, calculateCommonStagingManifestSha256, MariaCommonStagingRepository, type CommonStagingExtractionManifest } from "../src/data-migration/common-staging-extractor.js";
import { calculateRawLandingBundleSha256 } from "../src/data-migration/maria-raw-landing-repository.js";
import { createObjectAuditValues, createObjectIdentityCandidate } from "../src/identity/object-identity-audit-provider.js";

const integration = process.env.RUN_MARIADB_INTEGRATION === "true" ? describe : describe.skip;
const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

integration("data migration common staging MariaDB", () => {
  let database: DatabaseClient;
  let rawRunId: string;
  const nonce = `${Date.now()}-${Math.random()}`;
  const payload = Buffer.from(JSON.stringify({ member: { alpha: { owner: "synthetic-owner", bag: { item: "9007199254740993" } } }, capturedAt: "2026-09-03 15:30:00" }));
  const sourcePathSha256 = sha(`common-staging-${nonce}`);
  const sourceContentSha256 = sha(payload);
  const rawBundleSha256 = calculateRawLandingBundleSha256([{ pathSha256: sourcePathSha256, contentSha256: sourceContentSha256, size: payload.byteLength, storageName: `${sourcePathSha256}.bin` }]);
  const manifest: CommonStagingExtractionManifest = {
    format: "hoibot-common-staging-extraction-manifest-v1",
    rawBundleSha256,
    snapshotManifestSha256: sha(`snapshot-${nonce}`),
    actor: "common-staging-integration",
    entries: [{
      sourcePathSha256,
      sourceContentSha256,
      logicalSourceName: "data/member.json",
      sourceNamespace: "member.json",
      disposition: "PROJECT",
      records: [{ sourcePointer: "/member/alpha/bag/item", ownerPathSegmentIndex: 1, ownerPointer: "/member/alpha", recordDomain: "INVENTORY", recordKind: "OWNERSHIP_QUANTITY", projectionStatus: "PROJECT", quantityPointer: "/member/alpha/bag/item", observedTimePointer: "/capturedAt" }]
    }]
  };

  before(async () => {
    const config = loadConfig();
    assertCommonStagingDatabaseName(config.database.name);
    database = createDatabaseClient(config.database);
    rawRunId = createObjectIdentityCandidate();
    const rawFileId = createObjectIdentityCandidate();
    const audit = createObjectAuditValues("common-staging-integration");
    await database.execute("INSERT INTO data_migration_raw_runs(raw_landing_run_id,run_key,snapshot_manifest_sha256,bundle_sha256,expected_file_count,expected_total_bytes,run_status,raw_landing_completed_time,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,'COMPLETE',?,?,?,?,?)", [rawRunId, rawBundleSha256, manifest.snapshotManifestSha256, rawBundleSha256, 1, payload.byteLength, audit.UPDATE_TIME, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
    await database.execute("INSERT INTO data_migration_raw_files(raw_landing_file_id,raw_landing_run_id,source_path_sha256,source_content_sha256,size_bytes,payload,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?)", [rawFileId, rawRunId, sourcePathSha256, sourceContentSha256, payload.byteLength, payload, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
  });

  after(async () => {
    await new MariaCommonStagingRepository(database).rollback(rawBundleSha256, calculateCommonStagingManifestSha256(manifest));
    await database.execute("DELETE FROM data_migration_raw_runs WHERE raw_landing_run_id=?", [rawRunId]);
    await database.close();
  });

  it("stages lossless quantity, replays with zero writes and rolls back by run", async () => {
    const repository = new MariaCommonStagingRepository(database);
    const first = await repository.extractAndStage(manifest);
    const replay = await repository.extractAndStage({ ...manifest, actor: "common-staging-replay" });
    assert.equal(first.insertedRecords, 1);
    assert.equal(replay.insertedRecords, 0);
    assert.equal(replay.commonStagingRunId, first.commonStagingRunId);
    const rows = await database.query<Array<{ quantity_value: string; owner_locator_sha256: string; insert_time: string }>>(
      "SELECT CAST(quantity_value AS CHAR) quantity_value,owner_locator_sha256,INSERT_TIME insert_time FROM data_migration_common_staging_records WHERE common_staging_run_id=?",
      [first.commonStagingRunId]
    );
    assert.equal(rows[0]?.quantity_value, "9007199254740993");
    assert.match(rows[0]?.owner_locator_sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.match(rows[0]?.insert_time ?? "", /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.equal(await repository.rollback(rawBundleSha256, calculateCommonStagingManifestSha256(manifest)), 1);
    const remaining = await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM data_migration_common_staging_records WHERE common_staging_run_id=?", [first.commonStagingRunId]);
    assert.equal(Number(remaining[0]?.count_value), 0);
  });
});
