export const HOME_PASS_REFORM_CLEANUP_COMMAND = "/펫홈패스개편정리";

// 파괴적 정리 명령은 레거시와 동일한 인자 없는 정확 일치만 허용합니다.
export function isHomePassReformCleanupCommand(message: string | undefined): boolean {
  return message === HOME_PASS_REFORM_CLEANUP_COMMAND;
}

export function normalizeHomePassReformCleanupDispatchMessage(message: string): string {
  return isHomePassReformCleanupCommand(message) ? HOME_PASS_REFORM_CLEANUP_COMMAND : message;
}
