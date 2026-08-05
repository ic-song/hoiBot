import type { IrisPayload, NormalizedIrisEvent } from "./iris-normalizer.js";

export const IRIS_EVENT_MONITOR_PREFIX = "🔭 [Iris 이벤트 감지]";

// JSON 문자열에서 객체의 필드명만 안전하게 추출합니다.
function readJsonKeys(value: unknown): string[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? Object.keys(parsed)
      : [];
  } catch {
    return [];
  }
}

// JSON 문자열을 이벤트 분류에 사용할 객체로 안전하게 읽습니다.
function readJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

// 일반 텍스트와 모니터 자체 출력은 제외하되 멘션이 포함된 type=1 이벤트는 유지합니다.
export function shouldMonitorIrisEvent(payload: IrisPayload, event: NormalizedIrisEvent): boolean {
  if (event.message?.startsWith(IRIS_EVENT_MONITOR_PREFIX)) return false;
  if (event.eventKind !== "1") return true;
  if (event.origin !== "MSG" && event.origin !== "WRITE") return true;
  const attachment = readJsonRecord(payload.json?.attachment);
  const mentions = attachment?.mentions;
  return (Array.isArray(mentions) && mentions.length > 0) || attachment?.bot_command !== undefined;
}

// 실관측·상위 구현 기준으로 이벤트 종류의 읽기 쉬운 후보명을 반환합니다.
function classifyEvent(payload: IrisPayload, event: NormalizedIrisEvent): string {
  const attachment = readJsonRecord(payload.json?.attachment);
  if (event.eventKind === "1" && (Array.isArray(attachment?.mentions) || attachment?.bot_command !== undefined)) {
    return "멘션 감지";
  }
  if (event.eventKind === "2") return "단일 이미지 감지";
  if (event.eventKind === "27") return "다중 이미지 감지";
  if (event.eventKind === "26") return "답글 감지";
  if (event.origin === "SYNCMODMSG") return "메시지 수정 후보";
  if (event.origin === "SYNCDLMSG") return "메시지 삭제 후보";
  if (event.origin === "NEWMEM") return "입장 후보";
  if (event.origin === "DELMEM") return "퇴장·강퇴 후보";
  if (event.eventKind === "1") return "텍스트·일반 메시지 감지";
  return "미분류 이벤트 감지";
}

// TEST 방에서 확인할 수 있도록 Iris 이벤트의 핵심 필드를 요약합니다.
export function formatIrisEventMonitorMessage(
  payload: IrisPayload,
  event: NormalizedIrisEvent
): string {
  const json = payload.json ?? {};
  const attachmentKeys = readJsonKeys(json.attachment);
  const vKeys = readJsonKeys(json.v);
  const message = event.message === undefined
    ? "없음"
    : event.message.length > 500 ? `${event.message.slice(0, 500)}…` : event.message;
  return [
    IRIS_EVENT_MONITOR_PREFIX,
    `• 분류: ${classifyEvent(payload, event)}`,
    `• type: ${event.eventKind}`,
    `• origin: ${event.origin ?? "없음"}`,
    `• direction: ${event.direction}`,
    `• isMine: ${event.direction === "outgoing"}`,
    `• room: ${typeof payload.room === "string" ? payload.room : "없음"}`,
    `• sender: ${event.displayName ?? "없음"}`,
    `• chat_id: ${event.channelId ?? "없음"}`,
    `• user_id: ${event.userId ?? "없음"}`,
    `• event_id: ${event.providerEventId}`,
    `• message: ${message}`,
    `• attachment keys: ${attachmentKeys.length > 0 ? attachmentKeys.join(", ") : "없음"}`,
    `• v keys: ${vKeys.length > 0 ? vKeys.join(", ") : "없음"}`
  ].join("\n");
}
