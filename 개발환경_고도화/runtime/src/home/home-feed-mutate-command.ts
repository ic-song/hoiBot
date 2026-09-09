export type HomeFeedMutationCommand =
  | { kind: "create"; commandCode: "HOME_FEED_CREATE"; content: string | null }
  | { kind: "delete"; commandCode: "HOME_FEED_DELETE"; displayNumber: bigint | null }
  | { kind: "clear"; commandCode: "HOME_FEED_CLEAR" };

// 피드 작성·삭제·전체삭제의 레거시 exact/full-pattern 경계를 판별합니다.
export function isHomeFeedMutationCommandCandidate(message: string | undefined): boolean {
  if (message === undefined) return false;
  return message === "/피드"
    || /^\/피드\s+[\s\S]+$/.test(message)
    || message === "/피드삭제"
    || /^\/피드삭제\s+\d+$/.test(message)
    || message === "/피드전체삭제";
}

// DB command alias를 대표 exact 명령으로 정규화합니다.
export function normalizeHomeFeedMutationDispatchMessage(message: string): string {
  const parsed = parseHomeFeedMutationCommand(message);
  if (parsed?.kind === "create") return "/피드";
  if (parsed?.kind === "delete") return "/피드삭제";
  if (parsed?.kind === "clear") return "/피드전체삭제";
  return "";
}

// 완전한 피드 명령을 서비스 입력으로 파싱합니다.
export function parseHomeFeedMutationCommand(message: string): HomeFeedMutationCommand | null {
  if (message === "/피드전체삭제") return { kind: "clear", commandCode: "HOME_FEED_CLEAR" };
  if (message === "/피드삭제") return { kind: "delete", commandCode: "HOME_FEED_DELETE", displayNumber: null };
  const deleteMatch = /^\/피드삭제\s+(\d+)$/.exec(message);
  if (deleteMatch !== null) return { kind: "delete", commandCode: "HOME_FEED_DELETE", displayNumber: BigInt(deleteMatch[1]!) };
  if (message === "/피드") return { kind: "create", commandCode: "HOME_FEED_CREATE", content: null };
  const createMatch = /^\/피드\s+([\s\S]+)$/.exec(message);
  if (createMatch === null) return null;
  const content = createMatch[1]!.trim();
  return { kind: "create", commandCode: "HOME_FEED_CREATE", content: content.length === 0 ? null : content };
}
