const COMMAND = "/패스목록";

// 인자 없는 패스목록 명령만 정확히 허용합니다.
export function isPassListCommandCandidate(message: string | undefined): boolean {
  return message === COMMAND;
}

// DB command alias 조회용 대표 명령을 반환합니다.
export function normalizePassListDispatchMessage(message: string): string {
  return isPassListCommandCandidate(message) ? COMMAND : message;
}
