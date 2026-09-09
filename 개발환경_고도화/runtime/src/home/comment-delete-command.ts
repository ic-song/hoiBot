export type CommentDeleteCommand =
  | { kind: "GUIDE" }
  | { kind: "REMOVE"; listNumber: number };

export class CommentDeleteError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
  }
}

// 댓글 삭제 안내와 양의 정수 실행 명령만 전체 패턴으로 해석합니다.
export function parseCommentDeleteCommand(message: string): CommentDeleteCommand | undefined {
  if (message === "/댓글삭제") return { kind: "GUIDE" };
  const match = /^\/댓글삭제\s+([1-9]\d*)$/.exec(message);
  if (!match) return undefined;
  const listNumber = Number(match[1]);
  return Number.isSafeInteger(listNumber) ? { kind: "REMOVE", listNumber } : undefined;
}

// 공용 dispatch 후보를 안내 또는 완전한 숫자형 입력으로 제한합니다.
export function isCommentDeleteCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && parseCommentDeleteCommand(message) !== undefined;
}

// 숫자 인자를 command_registry의 단일 alias로 정규화합니다.
export function normalizeCommentDeleteDispatchMessage(message: string): string {
  return parseCommentDeleteCommand(message) ? "/댓글삭제" : message;
}
