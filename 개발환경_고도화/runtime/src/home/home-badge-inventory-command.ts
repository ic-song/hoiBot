export type HomeBadgeInventoryCommand =
  | { kind: "owned" }
  | { kind: "all" }
  | { kind: "detail"; selection: string };

// 홈뱃지 조회 세 명령을 exact 또는 완전한 단일 선택값 패턴으로만 허용합니다.
export function parseHomeBadgeInventoryCommand(message: string | undefined): HomeBadgeInventoryCommand | null {
  if (message === "/홈뱃지") return { kind: "owned" };
  if (message === "/홈뱃지전체") return { kind: "all" };
  if (message === undefined || !/^\/홈뱃지정보\s+\S(?:.*\S)?$/.test(message)) return null;
  return { kind: "detail", selection: message.replace(/^\/홈뱃지정보\s+/, "") };
}

// 공용 dispatch가 parameterized 상세 조회를 하나의 DB 별칭으로 판정하게 정규화합니다.
export function normalizeHomeBadgeInventoryDispatchMessage(message: string): string {
  return parseHomeBadgeInventoryCommand(message)?.kind === "detail" ? "/홈뱃지정보" : message;
}

export function isHomeBadgeInventoryCommand(message: string | undefined): boolean {
  return parseHomeBadgeInventoryCommand(message) !== null;
}
