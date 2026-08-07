import type { IrisPayload, NormalizedIrisEvent } from "./iris-normalizer.js";
import type { MembershipLogSummary } from "./membership-log-service.js";

export const IRIS_EVENT_MONITOR_PREFIX = "🔔 [호월봇 이벤트 감지]";
const LEGACY_IRIS_EVENT_MONITOR_PREFIX = "🔭 [Iris 이벤트 감지]";
const MAX_ORIGINAL_MESSAGE_LENGTH = 1_000;

export interface IrisOriginalMessageResult {
  status: "recovered" | "not_found" | "failed";
  message?: string;
}

// 일반 텍스트와 모니터 자체 출력만 제외하고 분류·후보·미분류 이벤트는 유지합니다.
export function shouldMonitorIrisEvent(_payload: IrisPayload, event: NormalizedIrisEvent): boolean {
  if (event.message?.startsWith(IRIS_EVENT_MONITOR_PREFIX)
    || event.message?.startsWith(LEGACY_IRIS_EVENT_MONITOR_PREFIX)) return false;
  return event.eventCode !== "message.created.text";
}

// 이벤트 코드를 운영자가 빠르게 읽을 수 있는 아이콘과 이름으로 변환합니다.
function describeEvent(event: NormalizedIrisEvent): { icon: string; label: string } {
  const labels: Record<string, { icon: string; label: string }> = {
    "message.created.mention": { icon: "📣", label: "멘션" },
    "message.created.reply": { icon: "↩️", label: "답글" },
    "message.created.thread_reply": { icon: "🧵", label: "스레드 답글" },
    "message.created.reply_candidate": { icon: "🧪", label: "답글 후보" },
    "message.created.text": { icon: "💬", label: "일반 메시지" },
    "message.edited": { icon: "✏️", label: "메시지 수정" },
    "message.deleted": { icon: "🗑️", label: "메시지 삭제" },
    "message.hidden_by_host": { icon: "🙈", label: "방장이 가린 메시지" },
    "message.rewritten": { icon: "♻️", label: "재작성 이벤트 후보" },
    "member.joined": { icon: "🚪", label: "멤버 입장" },
    "member.departed": { icon: "👋", label: "멤버 이탈 (자진·강퇴 미구분)" },
    "media.image": { icon: "🖼️", label: "이미지" },
    "media.image_candidate": { icon: "🧪", label: "이미지 후보" },
    "media.multi_image": { icon: "🖼️", label: "다중 이미지" },
    "media.multi_image_candidate": { icon: "🧪", label: "다중 이미지 후보" },
    "media.video": { icon: "🎬", label: "동영상" },
    "media.video_candidate": { icon: "🧪", label: "동영상 후보" },
    "media.sticker_candidate": { icon: "🧪", label: "이모티콘 후보" },
    "media.animated_sticker": { icon: "🎞️", label: "움직이는 이모티콘" },
    "media.animated_sticker_candidate": { icon: "🧪", label: "움직이는 이모티콘 후보" },
    "content.rich_card": { icon: "🔗", label: "검색·링크 카드" },
    "content.rich_card_candidate": { icon: "🧪", label: "검색·링크 카드 후보" }
  };
  return labels[event.eventCode] ?? { icon: "🧩", label: "미분류 이벤트" };
}

// 모니터링 방에서 운영자가 알아야 할 이벤트 종류와 검증된 이름만 간결하게 보여줍니다.
export function formatIrisEventMonitorMessage(
  _payload: IrisPayload,
  event: NormalizedIrisEvent,
  trustedRoomLabel?: string,
  incidentId?: string,
  membershipSummary?: MembershipLogSummary
): string {
  const description = describeEvent(event);
  const trustedDisplayName = event.displayNameTrust === "trusted" ? event.displayName : undefined;
  if (event.eventCode === "message.deleted" || event.eventCode === "message.hidden_by_host") {
    const eventLabel = event.eventCode === "message.deleted"
      ? "🗑️ [메시지 삭제 감지]"
      : "🙈 [방장 가리기 감지]";
    const incidentNumber = incidentId === undefined ? "미발급" : `#${incidentId}`;
    return [
      eventLabel,
      "",
      `📍 방: ${trustedRoomLabel ?? "확인되지 않음"}`,
      `👤 사용자: ${trustedDisplayName ?? "확인되지 않음"}`,
      `🔐 열람 번호: ${incidentNumber}`,
      "",
      incidentId === undefined
        ? "💬 원문 확인: 열람 번호가 발급되지 않았습니다."
        : `💬 원문 확인: /열람 #${incidentId}`
    ].join("\n");
  }
  if (event.eventCode === "member.joined" || event.eventCode === "member.departed") {
    const isJoined = event.eventCode === "member.joined";
    const eventLabel = isJoined ? "🚪 [입장 기록]" : "👋 [퇴장 기록]";
    const lines = [
      eventLabel,
      "",
      `📍 방: ${trustedRoomLabel ?? "확인되지 않음"}`,
      `👤 사용자: ${trustedDisplayName ?? "확인되지 않음"}`
    ];
    if (membershipSummary !== undefined) {
      lines.push(
        `🪪 계정: ${membershipSummary.systemAccountName ?? "미연동"}`,
        "",
        "📈 방문 정보",
        `• 총 ${membershipSummary.visitCount}회 방문`,
        `• 채팅 ${membershipSummary.messageCount}회 · 삭제 ${membershipSummary.deletionCount}회`,
        "",
        "🕒 시간 기록",
        `• ${isJoined ? "현재 입장" : "현재 퇴장"}: ${formatKoreaTime(membershipSummary.currentOccurredAt)}`,
        `• 첫 입장: ${formatOptionalKoreaTime(membershipSummary.firstJoinedAt)}`
      );
      if (isJoined) {
        lines.push(`• 이전 퇴장: ${formatOptionalKoreaTime(membershipSummary.previousDepartedAt)}`);
      }
      lines.push(
        "",
        "🔄 이전 닉네임",
        membershipSummary.previousDisplayNames.length === 0
          ? "• 기록 없음"
          : membershipSummary.previousDisplayNames.map((name) => `• ${name}`).join("\n"),
        "",
        "📜 최근 출입",
        ...membershipSummary.recentEntries.map((entry) =>
          `• ${formatKoreaTime(entry.occurredAt)} · ${entry.eventCode === "joined" ? "입장" : "퇴장"}`)
      );
    }
    return lines.join("\n");
  }
  const details = [
    IRIS_EVENT_MONITOR_PREFIX,
    `${description.icon} [${description.label}]`,
    "",
    `📍 방: ${trustedRoomLabel ?? "확인되지 않음"}`,
    `👤 사용자: ${trustedDisplayName ?? "확인되지 않음"}`,
    `🔄 방향: ${event.direction === "incoming" ? "수신" : "발신"}`
  ];
  if (typeof event.eventMetadata.mentionCount === "number" && event.eventMetadata.mentionCount > 0) {
    details.push(`📣 멘션 수: ${event.eventMetadata.mentionCount}`);
  }
  if (event.eventMetadata.classificationStatus !== "live_confirmed") {
    details.push("🧪 확인 상태: 추가 확인 필요");
  }
  return details.join("\n");
}

// 사건번호로 실시간 조회한 삭제·가리기 원문을 최소 정보와 함께 표시합니다.
export function formatModerationIncidentReadMessage(input: {
  incidentId: string;
  incidentType: "message_deleted" | "message_hidden_by_host" | "message_edited";
  roomName?: string;
  displayName?: string;
  originalMessage: IrisOriginalMessageResult;
}): string {
  const incidentLabel = input.incidentType === "message_deleted"
    ? "삭제된 메시지"
    : input.incidentType === "message_hidden_by_host" ? "방장이 가린 메시지" : "수정된 메시지";
  const body = input.originalMessage.status === "recovered"
    ? truncateOriginalMessage(input.originalMessage.message ?? "")
    : input.originalMessage.status === "failed" ? "조회에 실패했습니다." : "원문을 찾을 수 없습니다.";
  return [
    "🔎 [삭제 메시지 열람]",
    `📌 ${incidentLabel}`,
    "",
    `📍 방: ${input.roomName ?? "확인되지 않음"}`,
    `👤 사용자: ${input.displayName ?? "확인되지 않음"}`,
    `🔐 열람 번호: #${input.incidentId}`,
    "",
    "💬 원본 메시지:",
    body
  ].join("\n");
}

// 복원 원문을 최대 표시 길이로 제한합니다.
function truncateOriginalMessage(message: string): string {
  if (message.length <= MAX_ORIGINAL_MESSAGE_LENGTH) return message || "(빈 메시지)";
  return `${message.slice(0, MAX_ORIGINAL_MESSAGE_LENGTH)}… [원문 ${message.length}자 중 일부 표시]`;
}

// 출입 시각을 운영자가 읽기 쉬운 KST 문자열로 표시합니다.
function formatKoreaTime(value: Date): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${read("year")}.${read("month")}.${read("day")} ${read("hour")}:${read("minute")}:${read("second")}`;
}

// 기록이 없는 선택 시각을 명확하게 표시합니다.
function formatOptionalKoreaTime(value: Date | undefined): string {
  return value === undefined ? "기록 없음" : formatKoreaTime(value);
}
