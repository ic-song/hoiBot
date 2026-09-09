export type HomeLikeCommand = { kind: "like"; targetName: string } | { kind: "rank" } | { kind: "reset" };

// 좋아홈 세 명령을 exact 또는 완전한 대상 형식으로만 후보 처리합니다.
export function isHomeLikeCommandCandidate(message: string | undefined): boolean {
  return message === "/좋아홈순위" || message === "/좋아홈초기화"
    || (message !== undefined && /^\/좋아홈\s+\S(?:.*\S)?$/.test(message));
}

// 인접 명령과 충돌하지 않게 좋아요·순위·초기화를 분리합니다.
export function parseHomeLikeCommand(message: string): HomeLikeCommand | null {
  if (message === "/좋아홈순위") return { kind: "rank" };
  if (message === "/좋아홈초기화") return { kind: "reset" };
  const match = /^\/좋아홈\s+(\S(?:.*\S)?)$/.exec(message);
  return match === null ? null : { kind: "like", targetName: match[1]! };
}

// parameterized 좋아홈을 exact DB alias로 정규화합니다.
export function normalizeHomeLikeDispatchMessage(message: string): string {
  const command = parseHomeLikeCommand(message);
  return command?.kind === "like" ? "/좋아홈" : command?.kind === "rank" ? "/좋아홈순위" : command?.kind === "reset" ? "/좋아홈초기화" : message;
}
