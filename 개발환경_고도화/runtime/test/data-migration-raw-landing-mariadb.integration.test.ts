import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { calculateRawLandingBundleSha256, MariaRawLandingRepository, type RawLandingBundleEntry } from "../src/data-migration/maria-raw-landing-repository.js";

const integration = process.env.RUN_MARIADB_INTEGRATION === "true" ? describe : describe.skip;
const sha = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");

integration("data migration RAW landing MariaDB integration", () => {
  let database: DatabaseClient;
  const payloads = new Map<string, Buffer>();
  const entries: RawLandingBundleEntry[] = [Buffer.from("{\"member\":[]}", "utf8"), Buffer.from([0, 1, 2, 255])].map((payload, index) => {
    const pathSha256 = sha(`synthetic-${Date.now()}-${index}`);
    payloads.set(pathSha256, payload);
    return { pathSha256, contentSha256: sha(payload), size: payload.byteLength, storageName: `${pathSha256}.bin` };
  }).sort((left, right) => left.pathSha256.localeCompare(right.pathSha256, "en"));
  const manifest = { format: "hoibot-raw-landing-bundle-v1" as const, snapshotManifestSha256: sha(`snapshot-${Date.now()}`), fileCount: entries.length, totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0), bundleSha256: calculateRawLandingBundleSha256(entries), entries };

  before(async () => { database = createDatabaseClient(loadConfig().database); });
  after(async () => { await new MariaRawLandingRepository(database).rollbackRun(manifest.bundleSha256); await database.close(); });

  it("imports byte-exact payloads, replays with zero inserts and rolls back by run", async () => {
    const repository = new MariaRawLandingRepository(database);
    const load = async (entry: RawLandingBundleEntry): Promise<Buffer> => payloads.get(entry.pathSha256)!;
    const first = await repository.importBundle(manifest, load);
    const replay = await repository.importBundle(manifest, load);
    assert.equal(first.insertedFiles, 2);
    assert.equal(replay.insertedFiles, 0);
    assert.equal(replay.replayed, true);
    const rows = await database.query<Array<{ count_value: bigint; bytes_value: bigint }>>("SELECT COUNT(*) count_value,COALESCE(SUM(size_bytes),0) bytes_value FROM data_migration_raw_files WHERE raw_landing_run_id=?", [first.runId]);
    assert.equal(Number(rows[0]!.count_value), manifest.fileCount);
    assert.equal(Number(rows[0]!.bytes_value), manifest.totalBytes);
    await database.close();
    database = createDatabaseClient(loadConfig().database);
    const restartedRepository = new MariaRawLandingRepository(database);
    const restarted = await restartedRepository.importBundle(manifest, load);
    assert.equal(restarted.insertedFiles, 0);
    assert.equal(restarted.replayed, true);
    assert.equal(restarted.runId, first.runId);
    assert.equal(await restartedRepository.rollbackRun(manifest.bundleSha256), 1);
    const remaining = await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM data_migration_raw_files WHERE raw_landing_run_id=?", [first.runId]);
    assert.equal(Number(remaining[0]!.count_value), 0);
  });
});
