export type CommentPinCommand =
  | { kind: "GUIDE" }
  | { kind: "PIN"; listNumber: number };

export class CommentPinError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
  }
}

// 댓글 핀 안내와 양의 정수 등록 명령만 전체 패턴으로 해석합니다.
export function parseCommentPinCommand(message: string): CommentPinCommand | undefined {
  if (message === "/댓글핀") return { kind: "GUIDE" };
  const match = /^\/댓글핀\s+([1-9]\d*)$/.exec(message);
  if (!match) return undefined;
  const listNumber = Number(match[1]);
  return Number.isSafeInteger(listNumber) ? { kind: "PIN", listNumber } : undefined;
}

// 공용 dispatch 후보를 안내 또는 완전한 숫자형 입력으로 제한합니다.
export function isCommentPinCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && parseCommentPinCommand(message) !== undefined;
}

// 숫자 인자를 command_registry의 단일 alias로 정규화합니다.
export function normalizeCommentPinDispatchMessage(message: string): string {
  return parseCommentPinCommand(message) ? "/댓글핀" : message;
}
