// 레거시 데이터 전체 정리는 인자와 접미 문구가 없는 정확 명령만 허용합니다.
export function isLegacyDataCleanupCommand(message: string | undefined): boolean {
  return message === "/데이터정리";
}

// 정확 명령을 DB command_aliases의 단일 alias로 정규화합니다.
export function normalizeLegacyDataCleanupDispatchMessage(message: string): string {
  return isLegacyDataCleanupCommand(message) ? "/데이터정리" : message;
}
