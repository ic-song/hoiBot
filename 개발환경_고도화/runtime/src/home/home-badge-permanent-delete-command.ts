export type HomeBadgePermanentDeleteCommand = { selection: string };

// 영구삭제는 보유 번호 또는 badge ID 하나를 요구하는 완전한 패턴만 허용합니다.
export function parseHomeBadgePermanentDeleteCommand(message: string | undefined): HomeBadgePermanentDeleteCommand | null {
  if (message === undefined || !/^\/홈뱃지삭제\s+(?:\d+|[A-Za-z]{1,4}\d{2,3})$/.test(message)) return null;
  return { selection: message.replace(/^\/홈뱃지삭제\s+/, "") };
}

// parameterized 영구삭제 명령을 공용 dispatch 별칭으로 정규화합니다.
export function normalizeHomeBadgePermanentDeleteDispatchMessage(message: string): string {
  return parseHomeBadgePermanentDeleteCommand(message) === null ? message : "/홈뱃지삭제";
}

export function isHomeBadgePermanentDeleteCommand(message: string | undefined): boolean {
  return parseHomeBadgePermanentDeleteCommand(message) !== null;
}
