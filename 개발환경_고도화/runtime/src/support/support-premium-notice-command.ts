export interface SupportPremiumNoticeCommand {
  message: string | null;
}

// v2.400의 /알림 공백 또는 종료 후보 경계를 판별합니다.
export function isSupportPremiumNoticeCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && /^\/알림(?:\s|$)/.test(message);
}

// 인자 포함 명령을 command registry 대표 별칭으로 정규화합니다.
export function normalizeSupportPremiumNoticeDispatchMessage(message: string): string {
  return isSupportPremiumNoticeCommandCandidate(message) ? "/알림" : message;
}

// v2.400의 필수 공백·한 글자 이상 메시지 형식을 보존합니다.
export function parseSupportPremiumNoticeCommand(message: string): SupportPremiumNoticeCommand | null {
  if (!isSupportPremiumNoticeCommandCandidate(message)) return null;
  const match = message.match(/^\/알림\s+(.+)/);
  return { message: match?.[1] ?? null };
}
