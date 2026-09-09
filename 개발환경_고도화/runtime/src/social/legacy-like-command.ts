export type LegacyLikeCommand =
  | { kind: "like"; targetName: string }
  | { kind: "count" }
  | { kind: "rank" }
  | { kind: "reset" }
  | { kind: "daily-reset" };

// 레거시 broad guard와 정확 일치 명령을 서로 겹치지 않게 판별합니다.
export function isLegacyLikeCommandCandidate(message: string | undefined): boolean {
  return message === "/좋아요순위" || message === "/좋아리셋" || message === "/r"
    || message?.startsWith("/좋아요사용횟수") === true
    || message?.startsWith("/좋아요 ") === true;
}

// 레거시 대상 문자열과 조회 접미 허용 규칙을 보존해 명령을 해석합니다.
export function parseLegacyLikeCommand(message: string): LegacyLikeCommand | null {
  if (message === "/좋아요순위") return { kind: "rank" };
  if (message === "/좋아리셋") return { kind: "reset" };
  if (message === "/r") return { kind: "daily-reset" };
  if (message.startsWith("/좋아요사용횟수")) return { kind: "count" };
  if (message.startsWith("/좋아요 ")) return { kind: "like", targetName: message.slice("/좋아요 ".length) };
  return null;
}

// parameter 명령과 레거시 alias를 command_registry의 exact key로 정규화합니다.
export function normalizeLegacyLikeDispatchMessage(message: string): string {
  const command = parseLegacyLikeCommand(message);
  if (command?.kind === "like") return "/좋아요";
  if (command?.kind === "count") return "/좋아요사용횟수";
  if (command?.kind === "daily-reset") return "/r";
  return message;
}
