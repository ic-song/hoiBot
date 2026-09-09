import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { assertCatalogProjectionDatabaseName, calculateCatalogProjectionManifestSha256, MariaCatalogProjectionRepository } from "../src/data-migration/catalog-projection-provider.js";
import { assertCommonStagingDatabaseName, calculateCommonStagingManifestSha256, MariaCommonStagingRepository } from "../src/data-migration/common-staging-extractor.js";
import { createObjectAuditValues, createObjectIdentityCandidate } from "../src/identity/object-identity-audit-provider.js";
import { createStagingProjectionChainFixture } from "./fixtures/data-migration-staging-projection-chain.fixture.js";

const integration = process.env.RUN_MARIADB_INTEGRATION === "true" ? describe : describe.skip;

function runChild(env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "test/fixtures/data-migration-staging-projection-chain-child.ts"], { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`LEASE2620_CHILD_FAILED:${code}:${stderr}`)));
  });
}

integration("Lease2620 sealed RAW → common staging → catalog projection chain", () => {
  let database: DatabaseClient;
  let rawRunId = "";
  let commonRunId = "";
  let catalogRunId = "";
  const nonce = "lease2620-sealed-v1";
  const fixtureSeed = createStagingProjectionChainFixture(nonce, "a1234567");

  before(async () => {
    const config = loadConfig();
    assert.equal(["127.0.0.1", "localhost", "::1"].includes(config.database.host), true, "isolated loopback DB required");
    assert.notEqual(config.database.port, 3306, "operating DB port forbidden");
    assertCommonStagingDatabaseName(config.database.name);
    assertCatalogProjectionDatabaseName(config.database.name);
    database = createDatabaseClient(config.database);
    rawRunId = createObjectIdentityCandidate();
    const audit = createObjectAuditValues("lease2620-chain");
    await database.execute("INSERT INTO data_migration_raw_runs(raw_landing_run_id,run_key,snapshot_manifest_sha256,bundle_sha256,expected_file_count,expected_total_bytes,run_status,raw_landing_completed_time,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,'COMPLETE',?,?,?,?,?)", [rawRunId, fixtureSeed.commonManifest.rawBundleSha256, fixtureSeed.commonManifest.snapshotManifestSha256, fixtureSeed.commonManifest.rawBundleSha256, 1, fixtureSeed.payload.byteLength, audit.UPDATE_TIME, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
    await database.execute("INSERT INTO data_migration_raw_files(raw_landing_file_id,raw_landing_run_id,source_path_sha256,source_content_sha256,size_bytes,payload,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?)", [createObjectIdentityCandidate(), rawRunId, fixtureSeed.sourcePathSha256, fixtureSeed.sourceContentSha256, fixtureSeed.payload.byteLength, fixtureSeed.payload, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
  });

  after(async () => {
    const fixture = createStagingProjectionChainFixture(nonce, commonRunId || "a1234567");
    if (commonRunId !== "") await new MariaCatalogProjectionRepository(database).rollback(commonRunId, fixture.catalogManifest.catalogVersion, calculateCatalogProjectionManifestSha256(fixture.catalogManifest, fixture.policy));
    await new MariaCommonStagingRepository(database).rollback(fixture.commonManifest.rawBundleSha256, calculateCommonStagingManifestSha256(fixture.commonManifest));
    if (rawRunId !== "") await database.execute("DELETE FROM data_migration_raw_runs WHERE raw_landing_run_id=?", [rawRunId]);
    await database.close();
  });

  it("preserves the envelope, fingerprints and disposition counts across both actual providers", async () => {
    const staging = await new MariaCommonStagingRepository(database).extractAndStage(fixtureSeed.commonManifest);
    commonRunId = staging.commonStagingRunId;
    const fixture = createStagingProjectionChainFixture(nonce, commonRunId);
    const projection = await new MariaCatalogProjectionRepository(database).project(fixture.catalogManifest, fixture.policy);
    catalogRunId = projection.catalogProjectionRunId;
    assert.equal(staging.insertedRecords, 3);
    assert.equal(fixture.catalogManifest.commonStagingRunId, staging.commonStagingRunId);
    assert.equal(fixture.catalogManifest.commonStagingSha256, fixtureSeed.catalogManifest.commonStagingSha256);
    assert.deepEqual(projection, { catalogProjectionRunId: catalogRunId, insertedDecisions: 3, insertedProjectionRecords: 1, replayed: false });
    const run = (await database.query<Array<{ common_staging_run_id: string; staging_sha256: string; raw_bundle_sha256: string; extraction_manifest_sha256: string; projected_source_count: number; quarantined_source_count: number; ignored_source_count: number }>>("SELECT projection.common_staging_run_id,staging.staging_sha256,projection.raw_bundle_sha256,projection.extraction_manifest_sha256,projection.projected_source_count,projection.quarantined_source_count,projection.ignored_source_count FROM data_migration_catalog_projection_runs projection JOIN data_migration_common_staging_runs staging ON staging.common_staging_run_id=projection.common_staging_run_id WHERE projection.catalog_projection_run_id=?", [catalogRunId]))[0]!;
    assert.equal(run.common_staging_run_id, commonRunId);
    assert.equal(run.staging_sha256, fixture.catalogManifest.commonStagingSha256);
    assert.equal(run.raw_bundle_sha256, fixture.catalogManifest.commonStagingEnvelope.rawBundleSha256);
    assert.equal(run.extraction_manifest_sha256, fixture.catalogManifest.commonStagingEnvelope.extractionManifestSha256);
    assert.deepEqual([Number(run.projected_source_count), Number(run.quarantined_source_count), Number(run.ignored_source_count)], [1, 1, 1]);
    const fingerprints = await database.query<Array<{ payload_fingerprint: string }>>("SELECT payload_fingerprint FROM data_migration_common_staging_records WHERE common_staging_run_id=? ORDER BY source_locator_sha256", [commonRunId]);
    assert.deepEqual(fingerprints.map((row) => row.payload_fingerprint).sort(), [...fixture.payloadFingerprints].sort());
  });

  it("replays with DML0 in-process and after a child-process restart", async () => {
    const fixture = createStagingProjectionChainFixture(nonce, commonRunId);
    const stagingReplay = await new MariaCommonStagingRepository(database).extractAndStage({ ...fixture.commonManifest, actor: "lease2620-replay" });
    const projectionReplay = await new MariaCatalogProjectionRepository(database).project({ ...fixture.catalogManifest, actor: "lease2620-replay" }, fixture.policy);
    assert.deepEqual(stagingReplay, { commonStagingRunId: commonRunId, insertedRecords: 0, totalRecords: 3, replayed: true });
    assert.deepEqual(projectionReplay, { catalogProjectionRunId: catalogRunId, insertedDecisions: 0, insertedProjectionRecords: 0, replayed: true });
    const child = JSON.parse(await runChild({ LEASE2620_CHAIN_NONCE: nonce, LEASE2620_COMMON_RUN_ID: commonRunId })) as { staging: typeof stagingReplay; projection: typeof projectionReplay; stagingSha256: string; payloadFingerprints: string[] };
    assert.deepEqual(child.staging, stagingReplay);
    assert.deepEqual(child.projection, projectionReplay);
    assert.equal(child.stagingSha256, fixture.catalogManifest.commonStagingSha256);
    assert.deepEqual(child.payloadFingerprints, fixture.payloadFingerprints);
  });

  it("rolls back every catalog row when projection fails mid-transaction", async () => {
    const fixture = createStagingProjectionChainFixture(nonce, commonRunId);
    const triggerName = `lease2620_fail_${nonce.replace(/\D/g, "").slice(-16)}`;
    const failureSha = calculateCatalogProjectionManifestSha256(fixture.failureManifest, fixture.policy);
    await database.execute(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON data_migration_catalog_projection_records FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='LEASE2620_INJECTED_FAILURE'`);
    try {
      await assert.rejects(new MariaCatalogProjectionRepository(database).project(fixture.failureManifest, fixture.policy), /LEASE2620_INJECTED_FAILURE/);
    } finally {
      await database.execute(`DROP TRIGGER ${triggerName}`);
    }
    const residue = (await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM data_migration_catalog_projection_runs WHERE common_staging_run_id=? AND projection_manifest_sha256=?", [commonRunId, failureSha]))[0]!;
    assert.equal(Number(residue.count_value), 0);
  });
});
