import { createHash } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

export interface RawLandingBundleEntry {
  pathSha256: string;
  size: number;
  contentSha256: string;
  storageName: string;
}

export interface RawLandingBundleManifest {
  format: "hoibot-raw-landing-bundle-v1";
  snapshotManifestSha256: string;
  fileCount: number;
  totalBytes: number;
  bundleSha256: string;
  entries: RawLandingBundleEntry[];
}

export interface RawLandingImportResult {
  runId: string;
  insertedFiles: number;
  totalFiles: number;
  totalBytes: number;
  replayed: boolean;
}

interface RunRow {
  id: bigint;
  snapshot_manifest_sha256: string;
  bundle_sha256: string;
  expected_file_count: number;
  expected_total_bytes: bigint;
  run_status: "LOADING" | "COMPLETE";
}

const HASH = /^[a-f0-9]{64}$/;
const sha256 = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");

export function calculateRawLandingBundleSha256(entries: readonly RawLandingBundleEntry[]): string {
  return sha256(entries.map((entry) => `${entry.pathSha256}|${entry.size}|${entry.contentSha256}|${entry.storageName}`).join("\n"));
}

export function validateRawLandingBundleManifest(manifest: RawLandingBundleManifest): void {
  if (manifest.format !== "hoibot-raw-landing-bundle-v1") throw new Error("RAW_LANDING_FORMAT_MISMATCH");
  if (!HASH.test(manifest.snapshotManifestSha256) || !HASH.test(manifest.bundleSha256)) throw new Error("RAW_LANDING_HASH_INVALID");
  if (manifest.entries.length !== manifest.fileCount) throw new Error("RAW_LANDING_FILE_COUNT_MISMATCH");
  if (manifest.entries.reduce((sum, entry) => sum + entry.size, 0) !== manifest.totalBytes) throw new Error("RAW_LANDING_TOTAL_BYTES_MISMATCH");
  const sorted = [...manifest.entries].sort((left, right) => left.pathSha256.localeCompare(right.pathSha256, "en"));
  for (let index = 0; index < sorted.length; index += 1) {
    const entry = sorted[index]!;
    if (!HASH.test(entry.pathSha256) || !HASH.test(entry.contentSha256) || entry.storageName !== `${entry.pathSha256}.bin`) throw new Error("RAW_LANDING_ENTRY_INVALID");
    if (index > 0 && sorted[index - 1]!.pathSha256 === entry.pathSha256) throw new Error("RAW_LANDING_DUPLICATE_PATH");
  }
  if (calculateRawLandingBundleSha256(sorted) !== manifest.bundleSha256) throw new Error("RAW_LANDING_BUNDLE_HASH_MISMATCH");
}

export class MariaRawLandingRepository {
  constructor(private readonly database: DatabaseClient) {}

  async importBundle(
    manifest: RawLandingBundleManifest,
    loadPayload: (entry: RawLandingBundleEntry) => Promise<Buffer>
  ): Promise<RawLandingImportResult> {
    validateRawLandingBundleManifest(manifest);
    const run = await this.beginOrResume(manifest);
    let insertedFiles = 0;
    for (const entry of manifest.entries) {
      const payload = await loadPayload(entry);
      if (payload.byteLength !== entry.size || sha256(payload) !== entry.contentSha256) throw new Error("RAW_LANDING_PAYLOAD_HASH_MISMATCH");
      insertedFiles += await this.storeFile(run.id, entry, payload);
    }
    await this.complete(run.id, manifest);
    return { runId: run.id.toString(), insertedFiles, totalFiles: manifest.fileCount, totalBytes: manifest.totalBytes, replayed: insertedFiles === 0 };
  }

  async rollbackRun(bundleSha256: string): Promise<number> {
    if (!HASH.test(bundleSha256)) throw new Error("RAW_LANDING_HASH_INVALID");
    const result = await this.database.execute("DELETE FROM data_migration_raw_runs WHERE run_key = ?", [bundleSha256]);
    return Number(result.affectedRows);
  }

  private async beginOrResume(manifest: RawLandingBundleManifest): Promise<RunRow> {
    await this.database.execute(
      "INSERT IGNORE INTO data_migration_raw_runs(run_key,snapshot_manifest_sha256,bundle_sha256,expected_file_count,expected_total_bytes,run_status,created_at) VALUES (?,?,?,?,?,'LOADING',UTC_TIMESTAMP(3))",
      [manifest.bundleSha256, manifest.snapshotManifestSha256, manifest.bundleSha256, manifest.fileCount, manifest.totalBytes]
    );
    const rows = await this.database.query<RunRow[]>("SELECT id,snapshot_manifest_sha256,bundle_sha256,expected_file_count,expected_total_bytes,run_status FROM data_migration_raw_runs WHERE run_key=?", [manifest.bundleSha256]);
    const row = rows[0];
    if (!row) throw new Error("RAW_LANDING_RUN_NOT_FOUND");
    if (row.snapshot_manifest_sha256 !== manifest.snapshotManifestSha256 || row.bundle_sha256 !== manifest.bundleSha256 || Number(row.expected_file_count) !== manifest.fileCount || Number(row.expected_total_bytes) !== manifest.totalBytes) throw new Error("RAW_LANDING_RUN_CONFLICT");
    return row;
  }

  private async storeFile(runId: bigint, entry: RawLandingBundleEntry, payload: Buffer): Promise<number> {
    return this.database.withTransaction(async (transaction) => {
      const run = (await transaction.query<RunRow[]>("SELECT id,snapshot_manifest_sha256,bundle_sha256,expected_file_count,expected_total_bytes,run_status FROM data_migration_raw_runs WHERE id=? FOR UPDATE", [runId]))[0];
      if (!run) throw new Error("RAW_LANDING_RUN_NOT_FOUND");
      const existing = await transaction.query<Array<{ source_content_sha256: string; size_bytes: bigint; payload_sha256: string }>>(
        "SELECT source_content_sha256,size_bytes,SHA2(payload,256) payload_sha256 FROM data_migration_raw_files WHERE run_id=? AND source_path_sha256=?",
        [runId, entry.pathSha256]
      );
      if (existing[0]) {
        if (existing[0].source_content_sha256 !== entry.contentSha256 || Number(existing[0].size_bytes) !== entry.size || existing[0].payload_sha256 !== entry.contentSha256) throw new Error("RAW_LANDING_STORED_FILE_CONFLICT");
        return 0;
      }
      if (run.run_status === "COMPLETE") throw new Error("RAW_LANDING_COMPLETE_RUN_MISSING_FILE");
      await transaction.execute("INSERT INTO data_migration_raw_files(run_id,source_path_sha256,source_content_sha256,size_bytes,payload,imported_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))", [runId, entry.pathSha256, entry.contentSha256, entry.size, payload]);
      return 1;
    });
  }

  private async complete(runId: bigint, manifest: RawLandingBundleManifest): Promise<void> {
    await this.database.withTransaction(async (transaction: DatabaseTransaction) => {
      const rows = await transaction.query<Array<{ source_path_sha256: string; source_content_sha256: string; size_bytes: bigint }>>(
        "SELECT source_path_sha256,source_content_sha256,size_bytes FROM data_migration_raw_files WHERE run_id=? ORDER BY source_path_sha256",
        [runId]
      );
      const entries = rows.map((row) => ({ pathSha256: row.source_path_sha256, contentSha256: row.source_content_sha256, size: Number(row.size_bytes), storageName: `${row.source_path_sha256}.bin` }));
      if (entries.length !== manifest.fileCount || entries.reduce((sum, entry) => sum + entry.size, 0) !== manifest.totalBytes || calculateRawLandingBundleSha256(entries) !== manifest.bundleSha256) throw new Error("RAW_LANDING_DB_PARITY_MISMATCH");
      await transaction.execute("UPDATE data_migration_raw_runs SET run_status='COMPLETE',completed_at=COALESCE(completed_at,UTC_TIMESTAMP(3)) WHERE id=?", [runId]);
    });
  }
}
