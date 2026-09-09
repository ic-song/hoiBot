import { createHash } from "node:crypto";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface MigrationDelimiterEvidenceReceipt {
  migration490: { fileSha256: string; recordedChecksum: string; appliedTime: string };
  resultHashPayload: { migrationFileSha256: string; rawTranscriptSha256: string; [key: string]: JsonValue };
  resultSha256: string;
}

export const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");

// Object key는 Unicode code point 순으로 정렬하고 array 순서는 보존하며 공백 없는 UTF-8 JSON을 hash한다.
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(",")}}`;
}

export function assertMigrationDelimiterEvidence(receipt: MigrationDelimiterEvidenceReceipt, migrationBytes: Buffer, transcriptBytes: Buffer): void {
  const migrationFileSha256 = sha256(migrationBytes);
  const normalizedTranscript = transcriptBytes.toString("utf8").replace(/\r\n/g, "\n");
  if (migrationFileSha256 !== receipt.migration490.fileSha256 || migrationFileSha256 !== receipt.migration490.recordedChecksum || migrationFileSha256 !== receipt.resultHashPayload.migrationFileSha256) throw new Error("MIGRATION_DELIMITER_EVIDENCE_FILE_SHA_MISMATCH");
  if (sha256(normalizedTranscript) !== receipt.resultHashPayload.rawTranscriptSha256) throw new Error("MIGRATION_DELIMITER_EVIDENCE_TRANSCRIPT_SHA_MISMATCH");
  if (sha256(canonicalJson(receipt.resultHashPayload)) !== receipt.resultSha256) throw new Error("MIGRATION_DELIMITER_EVIDENCE_RESULT_SHA_MISMATCH");
}
