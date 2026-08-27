// 디버깅 모드는 인자와 접미 문구가 없는 정확 명령만 허용합니다.
export function isDebugModeCommand(message: string | undefined): boolean {
  return message === "/디버깅모드";
}

// 정확 명령을 DB command_aliases의 단일 alias로 정규화합니다.
export function normalizeDebugModeDispatchMessage(message: string): string {
  return isDebugModeCommand(message) ? "/디버깅모드" : message;
}
