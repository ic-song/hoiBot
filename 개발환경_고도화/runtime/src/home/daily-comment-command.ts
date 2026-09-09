export type DailyCommentCommand =
  | { kind: "guide" }
  | { kind: "write"; body: string }
  | { kind: "read"; targetName: string | null };

// /댓글과 /댓글확인 family를 인접 명령과 충돌하지 않게 판별합니다.
export function isDailyCommentCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && (message === "/댓글" || /^\/댓글\s+.+$/.test(message)
    || message === "/댓글확인" || /^\/댓글확인\s+.+$/.test(message));
}

// 댓글 작성 raw body와 확인 대상을 완전한 명령으로 해석합니다.
export function parseDailyCommentCommand(message: string): DailyCommentCommand | null {
  if (!isDailyCommentCommandCandidate(message)) return null;
  if (message === "/댓글") return { kind: "guide" };
  if (message === "/댓글확인") return { kind: "read", targetName: null };
  if (message.startsWith("/댓글확인 ")) return { kind: "read", targetName: message.slice(6).trim() };
  return { kind: "write", body: message.slice(3).trim() };
}

// parameterized family를 두 exact DB alias로 정규화합니다.
export function normalizeDailyCommentDispatchMessage(message: string): string {
  const command = parseDailyCommentCommand(message);
  return command?.kind === "read" ? "/댓글확인" : command ? "/댓글" : message;
}
