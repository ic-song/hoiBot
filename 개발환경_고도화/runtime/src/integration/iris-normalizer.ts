import { createHash } from "node:crypto";
import { classifyIrisEvent, type IrisMonitoringGroup } from "./iris-event-classifier.js";

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
  displayNameSource: "iris_cache" | "kakao_db" | "system_account";
  displayNameTrust: "untrusted" | "trusted";
  message?: string;
  eventCode: string;
  eventCategory: string;
  monitoringGroup: IrisMonitoringGroup;
  targetProviderEventId?: string;
  eventMetadata: Record<string, string | number | boolean | null>;
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
    const stringSafeJson = value.replace(
      /(^|[:,\[]\s*)(-?\d{16,})(?=\s*[,}\]])/g,
      (_match, prefix: string, integer: string) => `${prefix}"${integer}"`
    );
    const parsed: unknown = JSON.parse(stringSafeJson);
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

// 시스템 이벤트에서 개인정보 원문을 제외한 상관관계 메타데이터만 추출합니다.
function readSystemEventMetadata(system: Record<string, unknown> | undefined): {
  targetProviderEventId?: string;
  metadata: Record<string, string | number | boolean | null>;
} {
  if (system === undefined) return { metadata: {} };
  const targetProviderEventId = readExternalId(system.logId)
    ?? readExternalId(system.targetLogId)
    ?? readExternalId(system.src_logId);
  const metadata: Record<string, string | number | boolean | null> = {};
  for (const key of ["feedType", "hidden", "byHost", "targetRevision", "coverType"] as const) {
    const value = system[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      metadata[key] = value;
    }
  }
  const chatLogInfos = system.chatLogInfos;
  const firstChatLogInfo = Array.isArray(chatLogInfos) && typeof chatLogInfos[0] === "object"
    && chatLogInfos[0] !== null && !Array.isArray(chatLogInfos[0])
    ? chatLogInfos[0] as Record<string, unknown>
    : undefined;
  const targetType = firstChatLogInfo?.type;
  if (typeof targetType === "string" || typeof targetType === "number") {
    metadata.targetType = targetType;
  }
  return { targetProviderEventId, metadata };
}

// NEWMEM/DELMEM 시스템 피드에서 단일 출입 사용자의 ID와 당시 닉네임을 읽습니다.
function readMembershipIdentity(
  eventCode: string,
  system: Record<string, unknown> | undefined
): { userId?: string; displayName?: string; memberCount: number } | undefined {
  if (system === undefined || (eventCode !== "member.joined" && eventCode !== "member.departed")) {
    return undefined;
  }
  const candidates = eventCode === "member.joined"
    ? Array.isArray(system.members) ? system.members : []
    : system.member === undefined ? [] : [system.member];
  const members = candidates.filter((candidate): candidate is Record<string, unknown> =>
    typeof candidate === "object" && candidate !== null && !Array.isArray(candidate));
  if (members.length !== 1) return { memberCount: members.length };
  const displayName = typeof members[0]?.nickName === "string"
    ? members[0].nickName.trim() || undefined
    : undefined;
  return {
    userId: readExternalId(members[0]?.userId),
    displayName,
    memberCount: 1
  };
}

// Iris payload를 서버 내부 이벤트 계약으로 변환합니다.
export function normalizeIrisEvent(payload: IrisPayload): NormalizedIrisEvent {
  const json = payload.json ?? {};
  const payloadHash = hashPayload(payload);
  const providerEventId = readExternalId(json.id) ?? readExternalId(json._id) ?? payloadHash;
  const v = readRecord(json.v);
  const isMine = v?.isMine === true;
  const rawType = readExternalId(json.type) ?? "unknown";
  const origin = typeof v?.origin === "string"
    ? v.origin
    : typeof json.origin === "string" ? json.origin : undefined;
  const attachment = readRecord(json.attachment);
  const system = readRecord(json.message) ?? readRecord(payload.msg);
  const classification = classifyIrisEvent({ rawType, origin, attachment, system });
  const systemEvent = readSystemEventMetadata(system);
  const membershipIdentity = readMembershipIdentity(classification.eventCode, system);
  const replyTarget = rawType === "26" ? readExternalId(attachment?.src_logId) : undefined;
  const trustedMembershipName = membershipIdentity?.userId !== undefined
    && membershipIdentity.displayName !== undefined;

  return {
    eventId: `iris:${providerEventId}`,
    providerEventId,
    providerCode: "iris",
    eventKind: rawType,
    origin,
    direction: isMine ? "outgoing" : "incoming",
    channelId: readExternalId(json.chat_id),
    userId: membershipIdentity?.userId ?? readExternalId(json.user_id),
    displayName: trustedMembershipName
      ? membershipIdentity.displayName
      : typeof payload.sender === "string" ? payload.sender.trim() || undefined : undefined,
    displayNameSource: trustedMembershipName ? "kakao_db" : "iris_cache",
    displayNameTrust: trustedMembershipName ? "trusted" : "untrusted",
    message: typeof payload.msg === "string" ? payload.msg : undefined,
    eventCode: classification.eventCode,
    eventCategory: classification.eventCategory,
    monitoringGroup: classification.monitoringGroup,
    targetProviderEventId: systemEvent.targetProviderEventId ?? replyTarget,
    eventMetadata: {
      ...classification.metadata,
      ...systemEvent.metadata,
      ...(membershipIdentity === undefined ? {} : {
        membershipMemberCount: membershipIdentity.memberCount,
        membershipIdentitySource: membershipIdentity.userId === undefined
          ? "unresolved_system_feed"
          : "kakao_system_feed"
      })
    },
    payloadHash
  };
}
