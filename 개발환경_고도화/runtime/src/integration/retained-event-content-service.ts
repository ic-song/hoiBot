import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DatabaseClient } from "../database.js";
import type { IrisPayload, NormalizedIrisEvent } from "./iris-normalizer.js";

export interface RetainedEventContentConfig {
  enabled: boolean;
  retentionDays: number;
  storageDirectory: string;
  maxBytes: number;
  downloadTimeoutMs: number;
}

interface RetainedContentCandidate {
  sequenceNo: number;
  kind: "reply" | "image" | "animated_sticker";
  messageText?: string;
  replySourceText?: string;
  mediaUrl?: string;
  width?: number;
  height?: number;
}

interface StoredContentRow {
  id: bigint;
  content_kind: string;
  message_text: string | null;
  reply_source_text: string | null;
  storage_key: string | null;
  mime_type: string | null;
  byte_size: bigint | null;
  status: string;
  expires_at: Date;
}

// JSON 문자열의 큰 정수 ID를 문자열로 보존하며 객체로 읽습니다.
function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return undefined;
  try {
    const safe = value.replace(/(^|[:,\[]\s*)(-?\d{16,})(?=\s*[,}\]])/g,
      (_match, prefix: string, integer: string) => `${prefix}"${integer}"`);
    const parsed: unknown = JSON.parse(safe);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

// 개인정보 본문은 명시적으로 허용된 이벤트에서만 문자열로 읽습니다.
function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

// 숫자형 표시 메타데이터만 안전한 정수 범위로 제한합니다.
function readDimension(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100_000 ? parsed : undefined;
}

// 기능상 보관이 승인된 답글·이미지·움직이는 이모티콘만 후보로 만듭니다.
export function extractRetainedContent(
  payload: IrisPayload,
  event: NormalizedIrisEvent
): RetainedContentCandidate[] {
  const attachment = readRecord(payload.json?.attachment);
  if (event.eventCode === "message.created.reply") {
    return [{
      sequenceNo: 0,
      kind: "reply",
      messageText: readText(payload.msg),
      replySourceText: readText(attachment?.src_message)
    }];
  }
  if (event.eventCode === "media.image") {
    return [{
      sequenceNo: 0,
      kind: "image",
      mediaUrl: readText(attachment?.url),
      width: readDimension(attachment?.w ?? attachment?.width),
      height: readDimension(attachment?.h ?? attachment?.height)
    }];
  }
  if (event.eventCode === "media.multi_image") {
    const urls = Array.isArray(attachment?.imageUrls) ? attachment.imageUrls : [];
    const widths = Array.isArray(attachment?.wl) ? attachment.wl : [];
    const heights = Array.isArray(attachment?.hl) ? attachment.hl : [];
    return urls.slice(0, 10).flatMap((value, index) => {
      const mediaUrl = readText(value);
      return mediaUrl === undefined ? [] : [{
        sequenceNo: index,
        kind: "image" as const,
        mediaUrl,
        width: readDimension(widths[index]),
        height: readDimension(heights[index])
      }];
    });
  }
  if (event.eventCode === "media.animated_sticker") {
    return [{
      sequenceNo: 0,
      kind: "animated_sticker",
      mediaUrl: readText(attachment?.path ?? attachment?.url ?? attachment?.emoticonItemPath),
      width: readDimension(attachment?.width ?? attachment?.w),
      height: readDimension(attachment?.height ?? attachment?.h)
    }];
  }
  return [];
}

// 외부 다운로드는 검증된 Kakao HTTPS 호스트만 허용합니다.
function readTrustedMediaUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const trusted = host === "kakaocdn.net" || host.endsWith(".kakaocdn.net")
      || host === "kakao.com" || host.endsWith(".kakao.com");
    return parsed.protocol === "https:" && trusted ? parsed.toString() : undefined;
  } catch { return undefined; }
}

// MIME에 맞는 안전한 파일 확장자를 반환합니다.
function extensionForMime(mimeType: string): string {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/jpeg") return ".jpg";
  return ".img";
}

// 응답 본문을 설정된 최대 크기 안에서 Buffer로 내려받습니다.
async function downloadMedia(
  url: string,
  config: RetainedEventContentConfig,
  fetcher: typeof fetch
): Promise<{ data: Buffer; mimeType: string }> {
  const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(config.downloadTimeoutMs) });
  if (!response.ok) throw new Error(`MEDIA_HTTP_${response.status}`);
  const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? "";
  if (!mimeType.startsWith("image/")) throw new Error("MEDIA_TYPE_INVALID");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > config.maxBytes) throw new Error("MEDIA_TOO_LARGE");
  if (response.body === null) throw new Error("MEDIA_BODY_EMPTY");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > config.maxBytes) {
        await reader.cancel();
        throw new Error("MEDIA_TOO_LARGE");
      }
      chunks.push(Buffer.from(chunk.value));
    }
  } finally { reader.releaseLock(); }
  if (size === 0) throw new Error("MEDIA_BODY_EMPTY");
  return { data: Buffer.concat(chunks, size), mimeType };
}

// 지정방의 기능 필요 콘텐츠를 제한적으로 보관하고 만료 데이터를 정리합니다.
export class RetainedEventContentService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly config: RetainedEventContentConfig,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async retain(payload: IrisPayload, event: NormalizedIrisEvent): Promise<number> {
    if (!this.config.enabled) return 0;
    const candidates = extractRetainedContent(payload, event);
    if (candidates.length === 0) return 0;
    await mkdir(this.config.storageDirectory, { recursive: true });
    let retained = 0;
    for (const candidate of candidates) {
      const trustedUrl = readTrustedMediaUrl(candidate.mediaUrl);
      const initialStatus = candidate.kind === "reply" ? "stored"
        : trustedUrl === undefined ? "metadata_only" : "pending";
      const inserted = await this.database.execute(
        `INSERT IGNORE INTO retained_event_contents
          (event_id, sequence_no, content_kind, target_provider_event_id, message_text,
           reply_source_text, media_url, width, height, status, failure_code, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [event.eventId, candidate.sequenceNo, candidate.kind, event.targetProviderEventId ?? null,
          candidate.messageText ?? null, candidate.replySourceText ?? null, trustedUrl ?? null,
          candidate.width ?? null, candidate.height ?? null, initialStatus,
          candidate.kind !== "reply" && trustedUrl === undefined ? "MEDIA_URL_UNAVAILABLE" : null,
          new Date(Date.now() + this.config.retentionDays * 86_400_000)]
      );
      if (inserted.affectedRows === 0n) continue;
      retained += 1;
      if (trustedUrl === undefined || candidate.kind === "reply") continue;
      let storedPath: string | undefined;
      try {
        const downloaded = await downloadMedia(trustedUrl, this.config, this.fetcher);
        const storageKey = `${randomUUID()}${extensionForMime(downloaded.mimeType)}`;
        const finalPath = path.resolve(this.config.storageDirectory, storageKey);
        storedPath = finalPath;
        const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;
        await writeFile(temporaryPath, downloaded.data, { flag: "wx" });
        await rename(temporaryPath, finalPath);
        await this.database.execute(
          `UPDATE retained_event_contents
           SET storage_key = ?, mime_type = ?, byte_size = ?, sha256 = ?, status = 'stored', failure_code = NULL
           WHERE event_id = ? AND sequence_no = ?`,
          [storageKey, downloaded.mimeType, downloaded.data.byteLength,
            createHash("sha256").update(downloaded.data).digest("hex"), event.eventId, candidate.sequenceNo]
        );
      } catch (error) {
        if (storedPath !== undefined) await rm(storedPath, { force: true });
        await this.database.execute(
          `UPDATE retained_event_contents SET status = 'failed', failure_code = ?
           WHERE event_id = ? AND sequence_no = ?`,
          [error instanceof Error ? error.message.slice(0, 64) : "MEDIA_STORE_FAILED",
            event.eventId, candidate.sequenceNo]
        );
      }
    }
    return retained;
  }

  async purgeExpired(): Promise<number> {
    const rows = await this.database.query<Array<{ id: bigint; storage_key: string | null }>>(
      `SELECT id, storage_key FROM retained_event_contents
       WHERE status <> 'purged' AND expires_at <= UTC_TIMESTAMP(3) ORDER BY id LIMIT 500`
    );
    for (const row of rows) {
      if (row.storage_key !== null) {
        const resolved = path.resolve(this.config.storageDirectory, row.storage_key);
        const root = `${path.resolve(this.config.storageDirectory)}${path.sep}`;
        if (resolved.startsWith(root)) await rm(resolved, { force: true });
      }
      await this.database.execute(
        `UPDATE retained_event_contents
         SET message_text = NULL, reply_source_text = NULL, media_url = NULL, storage_key = NULL,
             mime_type = NULL, byte_size = NULL, sha256 = NULL, status = 'purged', failure_code = NULL
         WHERE id = ?`, [row.id]
      );
    }
    return rows.length;
  }

  async readDetail(contentId: string, operatorId: string): Promise<Record<string, unknown> | null> {
    const rows = await this.database.query<StoredContentRow[]>(
      `SELECT id, content_kind, message_text, reply_source_text, storage_key, mime_type,
              byte_size, status, expires_at
       FROM retained_event_contents WHERE id = ? LIMIT 1`, [contentId]
    );
    const row = rows[0];
    if (row === undefined) return null;
    await this.recordAccess(row.id, operatorId, "detail", row.status === "purged" ? "purged" : "success");
    return {
      id: row.id.toString(), contentKind: row.content_kind, messageText: row.message_text,
      replySourceText: row.reply_source_text, mediaAvailable: row.storage_key !== null && row.status === "stored",
      mimeType: row.mime_type, byteSize: row.byte_size?.toString() ?? null,
      status: row.status, expiresAt: row.expires_at.toISOString()
    };
  }

  async readMedia(contentId: string, operatorId: string): Promise<{ data: Buffer; mimeType: string } | null> {
    const rows = await this.database.query<StoredContentRow[]>(
      `SELECT id, content_kind, message_text, reply_source_text, storage_key, mime_type,
              byte_size, status, expires_at
       FROM retained_event_contents WHERE id = ? LIMIT 1`, [contentId]
    );
    const row = rows[0];
    if (row === undefined || row.status !== "stored" || row.storage_key === null || row.mime_type === null) {
      if (row !== undefined) await this.recordAccess(row.id, operatorId, "media", "unavailable");
      return null;
    }
    const resolved = path.resolve(this.config.storageDirectory, row.storage_key);
    const root = `${path.resolve(this.config.storageDirectory)}${path.sep}`;
    if (!resolved.startsWith(root)) return null;
    try {
      await access(resolved);
      const data = await readFile(resolved);
      await this.recordAccess(row.id, operatorId, "media", "success");
      return { data, mimeType: row.mime_type };
    } catch {
      await this.recordAccess(row.id, operatorId, "media", "unavailable");
      return null;
    }
  }

  private async recordAccess(
    contentId: bigint,
    operatorId: string,
    accessKind: "detail" | "media",
    resultCode: string
  ): Promise<void> {
    await this.database.execute(
      `INSERT INTO retained_content_access_log
        (retained_content_id, operator_id, access_kind, result_code, accessed_at)
       VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [contentId, operatorId, accessKind, resultCode]
    );
  }
}
