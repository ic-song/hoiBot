export const HOME_VISIT_RESET_COMMAND = "/펫홈방문초기화";

// 레거시와 동일하게 인자 없는 정확 일치 명령만 실행 후보로 인정합니다.
export function isHomeVisitResetCommand(message: string | undefined): boolean {
  return message === HOME_VISIT_RESET_COMMAND;
}

export function normalizeHomeVisitResetDispatchMessage(message: string): string {
  return isHomeVisitResetCommand(message) ? HOME_VISIT_RESET_COMMAND : message;
}
