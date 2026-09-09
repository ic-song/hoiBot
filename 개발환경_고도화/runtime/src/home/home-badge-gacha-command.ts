export type HomeBadgeGachaVariant = "open1" | "open2" | "open3";

export interface HomeBadgeGachaCommand {
  variant: HomeBadgeGachaVariant;
  commandCode: "HOME_BADGE_GACHA_OPEN_1" | "HOME_BADGE_GACHA_OPEN_2" | "HOME_BADGE_GACHA_OPEN_3";
  count: bigint | null;
  valid: boolean;
}

const COMMANDS = {
  open1: { alias: "/홈뱃지오픈", commandCode: "HOME_BADGE_GACHA_OPEN_1", defaultCount: 1n },
  open2: { alias: "/홈뱃지오픈2", commandCode: "HOME_BADGE_GACHA_OPEN_2", defaultCount: null },
  open3: { alias: "/홈뱃지오픈3", commandCode: "HOME_BADGE_GACHA_OPEN_3", defaultCount: 1n }
} as const;

// 세 명령의 exact 또는 공백으로 분리된 입력만 후보로 판별합니다.
export function isHomeBadgeGachaCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && /^\/홈뱃지오픈(?:2|3)?(?:$|\s)/.test(message);
}

// 숫자형 입력을 command registry의 대표 별칭으로 정규화합니다.
export function normalizeHomeBadgeGachaDispatchMessage(message: string): string {
  const parsed = parseHomeBadgeGachaCommand(message);
  return parsed === null ? message : COMMANDS[parsed.variant].alias;
}

// v2.400의 기본값·필수 숫자·1~100 범위를 보존해 해석합니다.
export function parseHomeBadgeGachaCommand(message: string): HomeBadgeGachaCommand | null {
  const variant: HomeBadgeGachaVariant | null = message === "/홈뱃지오픈" || /^\/홈뱃지오픈\s/.test(message)
    ? "open1"
    : message === "/홈뱃지오픈2" || /^\/홈뱃지오픈2\s/.test(message)
      ? "open2"
      : message === "/홈뱃지오픈3" || /^\/홈뱃지오픈3\s/.test(message)
        ? "open3"
        : null;
  if (variant === null) return null;
  const definition = COMMANDS[variant];
  if (message === definition.alias) {
    return { variant, commandCode: definition.commandCode, count: definition.defaultCount, valid: definition.defaultCount !== null };
  }
  const match = new RegExp(`^${definition.alias}\\s+(\\d+)$`).exec(message);
  if (match === null) return { variant, commandCode: definition.commandCode, count: null, valid: false };
  const count = BigInt(match[1]!);
  return { variant, commandCode: definition.commandCode, count, valid: count >= 1n && count <= 100n };
}
