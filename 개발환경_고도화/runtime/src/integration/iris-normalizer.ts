import { createHash } from "node:crypto";

export interface IrisPayload {
  msg?: unknown;
  room?: unknown;
  sender?: unknown;
  json?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface NormalizedIrisEvent {
  eventId: string;
  providerEventId: string;
  providerCode: "iris";
  eventKind: string;
  origin?: string;
  direction: "incoming" | "outgoing";
  channelId?: string;
  userId?: string;
  displayName?: string;
  message?: string;
  payloadHash: string;
}

// 외부 식별자는 숫자로 변환하지 않고 원문 문자열로 정규화합니다.
function readExternalId(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

// JSON 문자열 또는 객체의 필드를 안전하게 읽습니다.
function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

// 원문을 저장하지 않고 중복 판별용 안정적인 SHA-256만 생성합니다.
function hashPayload(payload: IrisPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

// Iris payload를 서버 내부 이벤트 계약으로 변환합니다.
export function normalizeIrisEvent(payload: IrisPayload): NormalizedIrisEvent {
  const json = payload.json ?? {};
  const payloadHash = hashPayload(payload);
  const providerEventId = readExternalId(json.id) ?? readExternalId(json._id) ?? payloadHash;
  const v = readRecord(json.v);
  const isMine = v?.isMine === true;
  const rawType = readExternalId(json.type) ?? "unknown";
  const origin = typeof json.origin === "string" ? json.origin : undefined;

  return {
    eventId: `iris:${providerEventId}`,
    providerEventId,
    providerCode: "iris",
    eventKind: rawType,
    origin,
    direction: isMine ? "outgoing" : "incoming",
    channelId: readExternalId(json.chat_id),
    userId: readExternalId(json.user_id),
    displayName: typeof payload.sender === "string" ? payload.sender.trim() || undefined : undefined,
    message: typeof payload.msg === "string" ? payload.msg : undefined,
    payloadHash
  };
}
