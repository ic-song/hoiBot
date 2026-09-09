export const HOME_ACTIVITY_FILE_BOOTSTRAP_COMMAND = "/펫홈활동파일생성";

// 활동 저장소 bootstrap은 레거시와 동일한 인자 없는 정확 일치만 허용합니다.
export function isHomeActivityFileBootstrapCommand(message: string | undefined): boolean {
  return message === HOME_ACTIVITY_FILE_BOOTSTRAP_COMMAND;
}

export function normalizeHomeActivityFileBootstrapDispatchMessage(message: string): string {
  return isHomeActivityFileBootstrapCommand(message) ? HOME_ACTIVITY_FILE_BOOTSTRAP_COMMAND : message;
}
