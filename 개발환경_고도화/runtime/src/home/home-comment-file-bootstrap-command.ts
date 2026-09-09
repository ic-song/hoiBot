export const HOME_COMMENT_FILE_BOOTSTRAP_COMMAND = "/펫홈댓글파일생성";

// 레거시와 동일하게 인자 없는 정확 일치 명령만 실행 후보로 인정합니다.
export function isHomeCommentFileBootstrapCommand(message: string | undefined): boolean {
  return message === HOME_COMMENT_FILE_BOOTSTRAP_COMMAND;
}

export function normalizeHomeCommentFileBootstrapDispatchMessage(message: string): string {
  return isHomeCommentFileBootstrapCommand(message) ? HOME_COMMENT_FILE_BOOTSTRAP_COMMAND : message;
}
