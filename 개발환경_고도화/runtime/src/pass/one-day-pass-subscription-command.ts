const COMMAND = "/원데이패스구독";

// 원데이패스 구독 지급은 인자 없는 정확 명령만 실행합니다.
export function isOneDayPassSubscriptionCommand(message: string | undefined): boolean {
  return message?.trim() === COMMAND;
}

// DB dispatch가 고정 대표 alias를 조회하도록 정규화합니다.
export function normalizeOneDayPassSubscriptionDispatchMessage(message: string): string {
  return isOneDayPassSubscriptionCommand(message) ? COMMAND : message;
}
