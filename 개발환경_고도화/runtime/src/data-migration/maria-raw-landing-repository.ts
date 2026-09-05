import { createHash } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { assertObjectIdentityCandidate, createObjectAuditValues, createObjectIdentityCandidate, type ObjectAuditValues } from "../identity/object-identity-audit-provider.js";

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
  raw_landing_run_id: string;
  snapshot_manifest_sha256: string;
  bundle_sha256: string;
  expected_file_count: number;
  expected_total_bytes: bigint;
  run_status: "LOADING" | "COMPLETE";
  raw_landing_completed_time?: string | null;
}

const HASH = /^[a-f0-9]{64}$/;
const sha256 = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");

function isDuplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && String(error.code) === "ER_DUP_ENTRY";
}

function isPrimaryDuplicate(error: unknown): boolean {
  const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  return isDuplicate(error) && /primary/i.test(message);
}

async function insertWithCuidRetry(
  transaction: DatabaseTransaction,
  sql: string,
  values: (candidate: string) => readonly unknown[]
): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = createObjectIdentityCandidate();
    assertObjectIdentityCandidate(candidate);
    try {
      await transaction.execute(sql, values(candidate));
      return candidate;
    } catch (error) {
      if (!isPrimaryDuplicate(error)) throw error;
    }
  }
  throw new Error("RAW_LANDING_CUID_COLLISION_RETRY_EXHAUSTED");
}

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
    const audit = createObjectAuditValues("raw-landing-import");
    const run = await this.beginOrResume(manifest, audit);
    let insertedFiles = 0;
    for (const entry of manifest.entries) {
      const payload = await loadPayload(entry);
      if (payload.byteLength !== entry.size || sha256(payload) !== entry.contentSha256) throw new Error("RAW_LANDING_PAYLOAD_HASH_MISMATCH");
      insertedFiles += await this.storeFile(run.raw_landing_run_id, entry, payload, audit);
    }
    await this.complete(run.raw_landing_run_id, manifest, audit);
    return { runId: run.raw_landing_run_id, insertedFiles, totalFiles: manifest.fileCount, totalBytes: manifest.totalBytes, replayed: insertedFiles === 0 };
  }

  async rollbackRun(bundleSha256: string): Promise<number> {
    if (!HASH.test(bundleSha256)) throw new Error("RAW_LANDING_HASH_INVALID");
    const result = await this.database.execute("DELETE FROM data_migration_raw_runs WHERE run_key = ?", [bundleSha256]);
    return Number(result.affectedRows);
  }

  private async beginOrResume(manifest: RawLandingBundleManifest, audit: ObjectAuditValues): Promise<RunRow> {
    let rows = await this.database.query<RunRow[]>("SELECT raw_landing_run_id,snapshot_manifest_sha256,bundle_sha256,expected_file_count,expected_total_bytes,run_status FROM data_migration_raw_runs WHERE run_key=?", [manifest.bundleSha256]);
    if (rows.length === 0) {
      try {
        await this.database.withTransaction((transaction) => insertWithCuidRetry(
          transaction,
          "INSERT INTO data_migration_raw_runs(raw_landing_run_id,run_key,snapshot_manifest_sha256,bundle_sha256,expected_file_count,expected_total_bytes,run_status,raw_landing_completed_time,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,'LOADING',NULL,?,?,?,?)",
          (candidate) => [candidate, manifest.bundleSha256, manifest.snapshotManifestSha256, manifest.bundleSha256, manifest.fileCount, manifest.totalBytes, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
        ));
      } catch (error) {
        // 동일 bundle UNIQUE 경합만 기존 행 재조회로 수렴합니다. PK 충돌은 위에서 제한 재시도합니다.
        if (!isDuplicate(error)) throw error;
      }
      rows = await this.database.query<RunRow[]>("SELECT raw_landing_run_id,snapshot_manifest_sha256,bundle_sha256,expected_file_count,expected_total_bytes,run_status FROM data_migration_raw_runs WHERE run_key=?", [manifest.bundleSha256]);
    }
    const row = rows[0];
    if (!row) throw new Error("RAW_LANDING_RUN_NOT_FOUND");
    if (row.snapshot_manifest_sha256 !== manifest.snapshotManifestSha256 || row.bundle_sha256 !== manifest.bundleSha256 || Number(row.expected_file_count) !== manifest.fileCount || Number(row.expected_total_bytes) !== manifest.totalBytes) throw new Error("RAW_LANDING_RUN_CONFLICT");
    return row;
  }

  private async storeFile(runId: string, entry: RawLandingBundleEntry, payload: Buffer, audit: ObjectAuditValues): Promise<number> {
    return this.database.withTransaction(async (transaction) => {
      const run = (await transaction.query<RunRow[]>("SELECT raw_landing_run_id,snapshot_manifest_sha256,bundle_sha256,expected_file_count,expected_total_bytes,run_status FROM data_migration_raw_runs WHERE raw_landing_run_id=? FOR UPDATE", [runId]))[0];
      if (!run) throw new Error("RAW_LANDING_RUN_NOT_FOUND");
      const existing = await transaction.query<Array<{ source_content_sha256: string; size_bytes: bigint; payload_sha256: string }>>(
        "SELECT source_content_sha256,size_bytes,SHA2(payload,256) payload_sha256 FROM data_migration_raw_files WHERE raw_landing_run_id=? AND source_path_sha256=?",
        [runId, entry.pathSha256]
      );
      if (existing[0]) {
        if (existing[0].source_content_sha256 !== entry.contentSha256 || Number(existing[0].size_bytes) !== entry.size || existing[0].payload_sha256 !== entry.contentSha256) throw new Error("RAW_LANDING_STORED_FILE_CONFLICT");
        return 0;
      }
      if (run.run_status === "COMPLETE") throw new Error("RAW_LANDING_COMPLETE_RUN_MISSING_FILE");
      await insertWithCuidRetry(
        transaction,
        "INSERT INTO data_migration_raw_files(raw_landing_file_id,raw_landing_run_id,source_path_sha256,source_content_sha256,size_bytes,payload,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (candidate) => [candidate, runId, entry.pathSha256, entry.contentSha256, entry.size, payload, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
      );
      return 1;
    });
  }

  private async complete(runId: string, manifest: RawLandingBundleManifest, audit: ObjectAuditValues): Promise<void> {
    await this.database.withTransaction(async (transaction: DatabaseTransaction) => {
      const run = (await transaction.query<RunRow[]>("SELECT raw_landing_run_id,snapshot_manifest_sha256,bundle_sha256,expected_file_count,expected_total_bytes,run_status,raw_landing_completed_time FROM data_migration_raw_runs WHERE raw_landing_run_id=? FOR UPDATE", [runId]))[0];
      if (run === undefined) throw new Error("RAW_LANDING_RUN_NOT_FOUND");
      const rows = await transaction.query<Array<{ source_path_sha256: string; source_content_sha256: string; size_bytes: bigint }>>(
        "SELECT source_path_sha256,source_content_sha256,size_bytes FROM data_migration_raw_files WHERE raw_landing_run_id=? ORDER BY source_path_sha256",
        [runId]
      );
      const entries = rows.map((row) => ({ pathSha256: row.source_path_sha256, contentSha256: row.source_content_sha256, size: Number(row.size_bytes), storageName: `${row.source_path_sha256}.bin` }));
      if (entries.length !== manifest.fileCount || entries.reduce((sum, entry) => sum + entry.size, 0) !== manifest.totalBytes || calculateRawLandingBundleSha256(entries) !== manifest.bundleSha256) throw new Error("RAW_LANDING_DB_PARITY_MISMATCH");
      if (run.run_status !== "COMPLETE") await transaction.execute("UPDATE data_migration_raw_runs SET run_status='COMPLETE',raw_landing_completed_time=?,UPDATE_USER=?,UPDATE_TIME=? WHERE raw_landing_run_id=?", [audit.UPDATE_TIME, audit.UPDATE_USER, audit.UPDATE_TIME, runId]);
    });
  }
}
