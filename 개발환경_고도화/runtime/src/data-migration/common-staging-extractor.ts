import { createHash } from "node:crypto";
import { isLosslessNumber, parse, stringify } from "lossless-json";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { assertObjectIdentityCandidate, createObjectAuditValues, createObjectIdentityCandidate, type ObjectAuditValues } from "../identity/object-identity-audit-provider.js";

export interface CommonStagingRecordDirective {
  sourcePointer: string;
  ownerPathSegmentIndex?: number;
  ownerPointer?: string;
  recordDomain: string;
  recordKind: string;
  projectionLocator?: string;
  projectionStatus: "PROJECT" | "QUARANTINE";
  quarantineReason?: string;
  quantityPointer?: string;
  observedTimePointer?: string;
}

export interface CommonStagingSourceDirective {
  sourcePathSha256: string;
  sourceContentSha256: string;
  logicalSourceName: string;
  sourceNamespace: string;
  disposition: "PROJECT" | "IGNORE";
  ignoreReason?: string;
  records: CommonStagingRecordDirective[];
}

export interface CommonStagingExtractionManifest {
  format: "hoibot-common-staging-extraction-manifest-v1";
  rawBundleSha256: string;
  snapshotManifestSha256: string;
  actor: string;
  entries: CommonStagingSourceDirective[];
}

export interface CommonStagingRecord {
  sourceSystem: "LEGACY_JSON";
  sourceNamespace: string;
  sourcePathSha256: string;
  sourceContentSha256: string;
  logicalSourceName: string;
  sourcePointer: string;
  identityPointer: string;
  sourceLocatorSha256: string;
  ownerLocatorSha256: string | null;
  occurrenceIndex: number;
  projectionLocator: string | null;
  recordDomain: string;
  recordKind: string;
  projectionStatus: "PROJECT" | "QUARANTINE";
  quarantineReason: string | null;
  quantityValue: string | null;
  observedTime: string | null;
  payloadJson: string;
  payloadFingerprint: string;
}

export interface CommonStagingExtraction {
  extractionManifestSha256: string;
  stagingSha256: string;
  records: CommonStagingRecord[];
}

export interface CommonStagingResult {
  commonStagingRunId: string;
  insertedRecords: number;
  totalRecords: number;
  replayed: boolean;
}

interface RawRunRow { id: bigint; snapshot_manifest_sha256: string; bundle_sha256: string; expected_file_count: number; expected_total_bytes: bigint; run_status: string; }
interface RawFileRow { source_content_sha256: string; payload: Buffer; payload_sha256: string; }
interface CommonRunRow { common_staging_run_id: string; snapshot_manifest_sha256: string; staging_sha256: string; expected_file_count: number; expected_total_bytes: bigint; expected_record_count: number; projected_file_count: number; ignored_file_count: number; run_status: string; }
interface StoredRecordRow {
  source_system: string; source_namespace: string; source_path_sha256: string; source_content_sha256: string;
  logical_source_name: string; source_pointer: string; identity_pointer: string; source_locator_sha256: string;
  owner_locator_sha256: string | null; occurrence_index: number; projection_locator: string | null;
  record_domain: string; record_kind: string; projection_status: string; quarantine_reason: string | null;
  quantity_value: string | null; observed_time: string | null; payload_json: string; payload_fingerprint: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const ASCII_TOKEN = /^[A-Za-z0-9_.-]+$/;
const RECORD_KIND = /^[A-Z][A-Z0-9_]{0,49}$/;
const KST_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const INTEGER = /^\d{1,65}$/;

const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

// Common Staging 적재·rollback을 격리된 설계/리허설 DB에만 허용합니다.
export function assertCommonStagingDatabaseName(databaseName: string): void {
  if (databaseName !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(databaseName)) throw new Error("COMMON_STAGING_OPERATIONAL_DATABASE_REFUSED");
}

// 키 순서와 숫자 정밀도에 독립적인 manifest/payload fingerprint 문자열을 만듭니다.
function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (isLosslessNumber(value)) return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("COMMON_STAGING_NON_FINITE_NUMBER");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  throw new Error("COMMON_STAGING_UNSUPPORTED_JSON_VALUE");
}

// RFC 6901 JSON Pointer로 RAW 문서의 정확한 값을 찾습니다.
function pointerValue(root: unknown, pointer: string): unknown {
  if (pointer === "") return root;
  if (!pointer.startsWith("/")) throw new Error("COMMON_STAGING_POINTER_INVALID");
  let current = root;
  for (const encoded of pointer.slice(1).split("/")) {
    const token = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(token) || Number(token) >= current.length) throw new Error("COMMON_STAGING_POINTER_NOT_FOUND");
      current = current[Number(token)];
    } else if (typeof current === "object" && current !== null && Object.prototype.hasOwnProperty.call(current, token)) {
      current = (current as Record<string, unknown>)[token];
    } else {
      throw new Error("COMMON_STAGING_POINTER_NOT_FOUND");
    }
  }
  return current;
}

function optionalPointer(root: unknown, pointer: string | undefined): unknown | undefined {
  return pointer === undefined ? undefined : pointerValue(root, pointer);
}

function validateManifest(manifest: CommonStagingExtractionManifest): void {
  if (manifest.format !== "hoibot-common-staging-extraction-manifest-v1") throw new Error("COMMON_STAGING_FORMAT_MISMATCH");
  if (!SHA256.test(manifest.rawBundleSha256) || !SHA256.test(manifest.snapshotManifestSha256)) throw new Error("COMMON_STAGING_HASH_INVALID");
  createObjectAuditValues(manifest.actor);
  if (manifest.entries.length === 0) throw new Error("COMMON_STAGING_SOURCE_COVERAGE_EMPTY");
  const paths = new Set<string>();
  for (const entry of manifest.entries) {
    if (!SHA256.test(entry.sourcePathSha256) || !SHA256.test(entry.sourceContentSha256)) throw new Error("COMMON_STAGING_SOURCE_HASH_INVALID");
    if (entry.logicalSourceName.trim() === "" || entry.logicalSourceName.length > 191 || entry.logicalSourceName.includes("\0")) throw new Error("COMMON_STAGING_LOGICAL_SOURCE_INVALID");
    if (entry.sourceNamespace.length === 0 || entry.sourceNamespace.length > 100 || !ASCII_TOKEN.test(entry.sourceNamespace)) throw new Error("COMMON_STAGING_SOURCE_NAMESPACE_INVALID");
    if (paths.has(entry.sourcePathSha256)) throw new Error("COMMON_STAGING_DUPLICATE_SOURCE_PATH");
    paths.add(entry.sourcePathSha256);
    if (entry.disposition === "PROJECT") {
      if (entry.records.length === 0 || entry.ignoreReason !== undefined) throw new Error("COMMON_STAGING_PROJECT_DISPOSITION_INVALID");
    } else if (entry.disposition === "IGNORE") {
      if (entry.records.length !== 0 || entry.ignoreReason === undefined || entry.ignoreReason.trim() === "" || entry.ignoreReason.length > 191) throw new Error("COMMON_STAGING_IGNORE_DISPOSITION_INVALID");
    } else {
      throw new Error("COMMON_STAGING_DISPOSITION_INVALID");
    }
    for (const record of entry.records) {
      if (!RECORD_KIND.test(record.recordDomain)) throw new Error("COMMON_STAGING_RECORD_DOMAIN_INVALID");
      if (!RECORD_KIND.test(record.recordKind)) throw new Error("COMMON_STAGING_RECORD_KIND_INVALID");
      if (record.projectionLocator !== undefined && (record.projectionLocator.trim() === "" || record.projectionLocator.length > 191 || record.projectionLocator.includes("\0"))) throw new Error("COMMON_STAGING_PROJECTION_LOCATOR_INVALID");
      if ((record.ownerPointer === undefined) !== (record.ownerPathSegmentIndex === undefined) || (record.ownerPathSegmentIndex !== undefined && (!Number.isInteger(record.ownerPathSegmentIndex) || record.ownerPathSegmentIndex < 0))) throw new Error("COMMON_STAGING_OWNER_PATH_SEGMENT_INVALID");
      if (record.projectionStatus === "PROJECT") {
        if (record.quarantineReason !== undefined) throw new Error("COMMON_STAGING_PROJECT_RECORD_INVALID");
      } else if (record.projectionStatus === "QUARANTINE") {
        if (record.quarantineReason === undefined || record.quarantineReason.trim() === "" || record.quarantineReason.length > 191 || !ASCII_TOKEN.test(record.quarantineReason)) throw new Error("COMMON_STAGING_QUARANTINE_RECORD_INVALID");
      } else {
        throw new Error("COMMON_STAGING_RECORD_DISPOSITION_INVALID");
      }
      for (const pointer of [record.sourcePointer, record.ownerPointer, record.quantityPointer, record.observedTimePointer]) {
        if (pointer !== undefined && pointer !== "" && !pointer.startsWith("/")) throw new Error("COMMON_STAGING_POINTER_INVALID");
        if (pointer !== undefined && (/~(?:[^01]|$)/.test(pointer) || pointer.includes("\0"))) throw new Error("COMMON_STAGING_POINTER_ESCAPE_INVALID");
      }
    }
  }
}

// 감사 actor와 분리된 extraction 지시 내용만으로 멱등 manifest fingerprint를 계산합니다.
export function calculateCommonStagingManifestSha256(manifest: CommonStagingExtractionManifest): string {
  validateManifest(manifest);
  return sha256(stableJson({
    format: manifest.format,
    rawBundleSha256: manifest.rawBundleSha256,
    snapshotManifestSha256: manifest.snapshotManifestSha256,
    entries: manifest.entries
  }));
}

function quantityString(value: unknown | undefined): string | null {
  if (value === undefined) return null;
  const candidate = isLosslessNumber(value) ? value.toString() : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? value : "";
  if (!INTEGER.test(candidate)) throw new Error("COMMON_STAGING_QUANTITY_INVALID");
  return candidate;
}

function observedTimeString(value: unknown | undefined): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !KST_TIME.test(value)) throw new Error("COMMON_STAGING_OBSERVED_TIME_INVALID");
  const [datePart, timePart] = value.split(" ") as [string, string];
  const [year, month, day] = datePart.split("-").map(Number) as [number, number, number];
  const [hour, minute, second] = timePart.split(":").map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day || parsed.getUTCHours() !== hour || parsed.getUTCMinutes() !== minute || parsed.getUTCSeconds() !== second) throw new Error("COMMON_STAGING_OBSERVED_TIME_INVALID");
  return value;
}

function pointerTokens(pointer: string): string[] {
  if (pointer === "") return [];
  return pointer.slice(1).split("/").map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function encodePointer(tokens: readonly string[]): string {
  return tokens.length === 0 ? "" : `/${tokens.map((token) => token.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

// 검증된 RAW JSON과 extraction manifest를 공통 identity envelope로 변환합니다.
export function extractCommonStagingRecords(manifest: CommonStagingExtractionManifest, payloadByPath: ReadonlyMap<string, Buffer>): CommonStagingExtraction {
  validateManifest(manifest);
  const records: CommonStagingRecord[] = [];
  const locators = new Set<string>();
  for (const entry of [...manifest.entries].sort((left, right) => left.sourcePathSha256.localeCompare(right.sourcePathSha256, "en"))) {
    const payload = payloadByPath.get(entry.sourcePathSha256);
    if (payload === undefined || sha256(payload) !== entry.sourceContentSha256) throw new Error("COMMON_STAGING_RAW_PAYLOAD_MISMATCH");
    if (entry.disposition === "IGNORE") continue;
    const root = parse(payload.toString("utf8"));
    for (let occurrenceIndex = 0; occurrenceIndex < entry.records.length; occurrenceIndex += 1) {
      const directive = entry.records[occurrenceIndex]!;
      const payloadValue = pointerValue(root, directive.sourcePointer);
      const payloadJson = stringify(payloadValue);
      if (payloadJson === undefined) throw new Error("COMMON_STAGING_PAYLOAD_INVALID");
      const identityTokens = pointerTokens(directive.sourcePointer);
      let ownerLocatorSha256: string | null = null;
      if (directive.ownerPathSegmentIndex !== undefined) {
        const ownerTokens = pointerTokens(directive.ownerPointer!);
        if (directive.ownerPathSegmentIndex >= identityTokens.length || ownerTokens.length !== directive.ownerPathSegmentIndex + 1 || ownerTokens.some((token, index) => identityTokens[index] !== token)) throw new Error("COMMON_STAGING_OWNER_PATH_SEGMENT_INVALID");
        pointerValue(root, directive.ownerPointer!);
        // WBS742 계약의 player-key-hash는 별도 표시값이 아니라 source pointer의 실제 owner key token을 봉인합니다.
        ownerLocatorSha256 = sha256(identityTokens[directive.ownerPathSegmentIndex]!);
        identityTokens[directive.ownerPathSegmentIndex] = ownerLocatorSha256;
      }
      const identityPointer = encodePointer(identityTokens);
      const occurrenceLocator = directive.projectionLocator ?? String(occurrenceIndex);
      const sourceLocatorSha256 = sha256(`${entry.logicalSourceName}\0${identityPointer}\0${directive.recordKind}\0${occurrenceLocator}`);
      if (locators.has(sourceLocatorSha256)) throw new Error("COMMON_STAGING_DUPLICATE_SOURCE_LOCATOR");
      locators.add(sourceLocatorSha256);
      records.push({
        sourceSystem: "LEGACY_JSON",
        sourceNamespace: entry.sourceNamespace,
        sourcePathSha256: entry.sourcePathSha256,
        sourceContentSha256: entry.sourceContentSha256,
        logicalSourceName: entry.logicalSourceName,
        sourcePointer: directive.sourcePointer,
        identityPointer,
        sourceLocatorSha256,
        ownerLocatorSha256,
        occurrenceIndex,
        projectionLocator: directive.projectionLocator ?? null,
        recordDomain: directive.recordDomain,
        recordKind: directive.recordKind,
        projectionStatus: directive.projectionStatus,
        quarantineReason: directive.quarantineReason ?? null,
        quantityValue: quantityString(optionalPointer(root, directive.quantityPointer)),
        observedTime: observedTimeString(optionalPointer(root, directive.observedTimePointer)),
        payloadJson,
        payloadFingerprint: sha256(stableJson(payloadValue))
      });
    }
  }
  return { extractionManifestSha256: calculateCommonStagingManifestSha256(manifest), stagingSha256: sha256(stableJson(records)), records };
}

function isDatabaseDuplicate(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  return code === "ER_DUP_ENTRY";
}

function isPrimaryDuplicate(error: unknown): boolean {
  const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  return isDatabaseDuplicate(error) && /primary/i.test(message);
}

async function insertWithCuidRetry(transaction: DatabaseTransaction, sql: string, values: (id: string) => readonly unknown[]): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = createObjectIdentityCandidate();
    assertObjectIdentityCandidate(id);
    try {
      await transaction.execute(sql, values(id));
      return id;
    } catch (error) {
      if (!isPrimaryDuplicate(error)) throw error;
    }
  }
  throw new Error("COMMON_STAGING_CUID_COLLISION_RETRY_EXHAUSTED");
}

// RAW Landing COMPLETE run을 검증하고 공통 staging 전체를 한 transaction으로 적재합니다.
export class MariaCommonStagingRepository {
  constructor(private readonly database: DatabaseClient) {}

  async extractAndStage(manifest: CommonStagingExtractionManifest): Promise<CommonStagingResult> {
    validateManifest(manifest);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.extractAndStageTransaction(manifest);
      } catch (error) {
        // 같은 manifest 동시 시작의 run UNIQUE 경합은 rollback 후 기존 COMPLETE run을 한 번 재검증합니다.
        if (attempt === 0 && isDatabaseDuplicate(error)) continue;
        throw error;
      }
    }
    throw new Error("COMMON_STAGING_CONCURRENT_REPLAY_UNRESOLVED");
  }

  private async extractAndStageTransaction(manifest: CommonStagingExtractionManifest): Promise<CommonStagingResult> {
    return this.database.withTransaction(async (transaction) => {
      const rawRun = (await transaction.query<RawRunRow[]>(
        "SELECT id,snapshot_manifest_sha256,bundle_sha256,expected_file_count,expected_total_bytes,run_status FROM data_migration_raw_runs WHERE bundle_sha256=? FOR UPDATE",
        [manifest.rawBundleSha256]
      ))[0];
      if (rawRun === undefined || rawRun.run_status !== "COMPLETE") throw new Error("COMMON_STAGING_RAW_RUN_NOT_COMPLETE");
      if (rawRun.snapshot_manifest_sha256 !== manifest.snapshotManifestSha256) throw new Error("COMMON_STAGING_SNAPSHOT_MISMATCH");
      if (Number(rawRun.expected_file_count) !== manifest.entries.length) throw new Error("COMMON_STAGING_SOURCE_COVERAGE_MISMATCH");

      const payloadByPath = new Map<string, Buffer>();
      for (const entry of manifest.entries) {
        const rawFile = (await transaction.query<RawFileRow[]>(
          "SELECT source_content_sha256,payload,SHA2(payload,256) payload_sha256 FROM data_migration_raw_files WHERE run_id=? AND source_path_sha256=?",
          [rawRun.id, entry.sourcePathSha256]
        ))[0];
        if (rawFile === undefined || rawFile.source_content_sha256 !== entry.sourceContentSha256 || rawFile.payload_sha256 !== entry.sourceContentSha256) throw new Error("COMMON_STAGING_RAW_FILE_MISMATCH");
        payloadByPath.set(entry.sourcePathSha256, rawFile.payload);
      }
      const extraction = extractCommonStagingRecords(manifest, payloadByPath);
      const prior = (await transaction.query<CommonRunRow[]>(
        "SELECT common_staging_run_id,snapshot_manifest_sha256,staging_sha256,expected_file_count,expected_total_bytes,expected_record_count,projected_file_count,ignored_file_count,run_status FROM data_migration_common_staging_runs WHERE raw_bundle_sha256=? AND extraction_manifest_sha256=? FOR UPDATE",
        [manifest.rawBundleSha256, extraction.extractionManifestSha256]
      ))[0];
      if (prior !== undefined) {
        const projectedFileCount = manifest.entries.filter((entry) => entry.disposition === "PROJECT").length;
        const ignoredFileCount = manifest.entries.length - projectedFileCount;
        if (prior.snapshot_manifest_sha256 !== manifest.snapshotManifestSha256 || prior.staging_sha256 !== extraction.stagingSha256 || Number(prior.expected_file_count) !== manifest.entries.length || BigInt(prior.expected_total_bytes) !== BigInt(rawRun.expected_total_bytes) || Number(prior.expected_record_count) !== extraction.records.length || Number(prior.projected_file_count) !== projectedFileCount || Number(prior.ignored_file_count) !== ignoredFileCount || prior.run_status !== "COMPLETE") throw new Error("COMMON_STAGING_REPLAY_CONFLICT");
        await this.verifyStored(transaction, prior.common_staging_run_id, extraction.records);
        return { commonStagingRunId: prior.common_staging_run_id, insertedRecords: 0, totalRecords: extraction.records.length, replayed: true };
      }

      const audit = createObjectAuditValues(manifest.actor);
      const projectedFileCount = manifest.entries.filter((entry) => entry.disposition === "PROJECT").length;
      const commonStagingRunId = await insertWithCuidRetry(
        transaction,
        "INSERT INTO data_migration_common_staging_runs(common_staging_run_id,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,staging_sha256,expected_file_count,expected_total_bytes,expected_record_count,projected_file_count,ignored_file_count,run_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,'STAGING',?,?,?,?)",
        (id) => [id, manifest.rawBundleSha256, manifest.snapshotManifestSha256, extraction.extractionManifestSha256, extraction.stagingSha256, manifest.entries.length, rawRun.expected_total_bytes, extraction.records.length, projectedFileCount, manifest.entries.length - projectedFileCount, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
      );
      for (const record of extraction.records) await this.insertRecord(transaction, commonStagingRunId, record, audit);
      await transaction.execute("UPDATE data_migration_common_staging_runs SET run_status='COMPLETE',UPDATE_USER=?,UPDATE_TIME=? WHERE common_staging_run_id=?", [audit.UPDATE_USER, audit.UPDATE_TIME, commonStagingRunId]);
      await this.verifyStored(transaction, commonStagingRunId, extraction.records);
      return { commonStagingRunId, insertedRecords: extraction.records.length, totalRecords: extraction.records.length, replayed: false };
    });
  }

  async rollback(rawBundleSha256: string, extractionManifestSha256: string): Promise<number> {
    if (!SHA256.test(rawBundleSha256) || !SHA256.test(extractionManifestSha256)) throw new Error("COMMON_STAGING_HASH_INVALID");
    const result = await this.database.execute("DELETE FROM data_migration_common_staging_runs WHERE raw_bundle_sha256=? AND extraction_manifest_sha256=?", [rawBundleSha256, extractionManifestSha256]);
    return Number(result.affectedRows);
  }

  private async insertRecord(transaction: DatabaseTransaction, commonStagingRunId: string, record: CommonStagingRecord, audit: ObjectAuditValues): Promise<void> {
    await insertWithCuidRetry(
      transaction,
      "INSERT INTO data_migration_common_staging_records(common_staging_record_id,common_staging_run_id,source_system,source_namespace,source_path_sha256,source_content_sha256,logical_source_name,source_pointer,identity_pointer,source_locator_sha256,owner_locator_sha256,occurrence_index,projection_locator,record_domain,record_kind,projection_status,quarantine_reason,quantity_value,observed_time,payload_json,payload_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      (id) => [id, commonStagingRunId, record.sourceSystem, record.sourceNamespace, record.sourcePathSha256, record.sourceContentSha256, record.logicalSourceName, record.sourcePointer, record.identityPointer, record.sourceLocatorSha256, record.ownerLocatorSha256, record.occurrenceIndex, record.projectionLocator, record.recordDomain, record.recordKind, record.projectionStatus, record.quarantineReason, record.quantityValue, record.observedTime, record.payloadJson, record.payloadFingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
    );
  }

  private async verifyStored(transaction: DatabaseTransaction, commonStagingRunId: string, expected: readonly CommonStagingRecord[]): Promise<void> {
    const rows = await transaction.query<StoredRecordRow[]>("SELECT source_system,source_namespace,source_path_sha256,source_content_sha256,logical_source_name,source_pointer,identity_pointer,source_locator_sha256,owner_locator_sha256,occurrence_index,projection_locator,record_domain,record_kind,projection_status,quarantine_reason,CAST(quantity_value AS CHAR) quantity_value,observed_time,CAST(payload_json AS CHAR) payload_json,payload_fingerprint FROM data_migration_common_staging_records WHERE common_staging_run_id=? ORDER BY source_locator_sha256", [commonStagingRunId]);
    const expectedRows = [...expected].sort((left, right) => left.sourceLocatorSha256.localeCompare(right.sourceLocatorSha256, "en"));
    if (rows.length !== expectedRows.length || rows.some((row, index) => {
      const item = expectedRows[index];
      return item === undefined || row.source_system !== item.sourceSystem || row.source_namespace !== item.sourceNamespace || row.source_path_sha256 !== item.sourcePathSha256 || row.source_content_sha256 !== item.sourceContentSha256 || row.logical_source_name !== item.logicalSourceName || row.source_pointer !== item.sourcePointer || row.identity_pointer !== item.identityPointer || row.source_locator_sha256 !== item.sourceLocatorSha256 || row.owner_locator_sha256 !== item.ownerLocatorSha256 || Number(row.occurrence_index) !== item.occurrenceIndex || row.projection_locator !== item.projectionLocator || row.record_domain !== item.recordDomain || row.record_kind !== item.recordKind || row.projection_status !== item.projectionStatus || row.quarantine_reason !== item.quarantineReason || row.quantity_value !== item.quantityValue || row.observed_time !== item.observedTime || row.payload_json !== item.payloadJson || row.payload_fingerprint !== item.payloadFingerprint;
    })) throw new Error("COMMON_STAGING_DB_PARITY_MISMATCH");
  }
}
