export type CommentPinDeleteCommand =
  | { kind: "GUIDE" }
  | { kind: "REMOVE"; listNumber: number };

export class CommentPinDeleteError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
  }
}

// 댓글 핀 삭제 안내와 숫자형 실행 명령을 전체 패턴으로 해석합니다.
export function parseCommentPinDeleteCommand(message: string): CommentPinDeleteCommand | undefined {
  if (message === "/댓글핀삭제") return { kind: "GUIDE" };
  const match = /^\/댓글핀삭제\s+([1-9]\d*)$/.exec(message);
  if (!match) return undefined;
  const listNumber = Number(match[1]);
  return Number.isSafeInteger(listNumber) ? { kind: "REMOVE", listNumber } : undefined;
}

// 댓글 핀 삭제 후보를 정확한 안내 또는 숫자형 입력으로 제한합니다.
export function isCommentPinDeleteCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && parseCommentPinDeleteCommand(message) !== undefined;
}

// 숫자 인자를 공용 dispatcher의 단일 alias로 정규화합니다.
export function normalizeCommentPinDeleteDispatchMessage(message: string): string {
  return parseCommentPinDeleteCommand(message) ? "/댓글핀삭제" : message;
}
