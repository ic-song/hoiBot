export const HOME_ACTIVITY_RESTORE_COMMAND = "/펫홈활동살리기";

// 파괴적 복구 명령은 레거시와 동일한 인자 없는 정확 일치만 허용합니다.
export function isHomeActivityRestoreCommand(message: string | undefined): boolean {
  return message === HOME_ACTIVITY_RESTORE_COMMAND;
}

export function normalizeHomeActivityRestoreDispatchMessage(message: string): string {
  return isHomeActivityRestoreCommand(message) ? HOME_ACTIVITY_RESTORE_COMMAND : message;
}
