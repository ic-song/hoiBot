export const PACKAGE_BAG_COMMAND = "/패키지가방";
export const PACKAGE_USE_COMMAND = "/패키지사용";
export const PACKAGE_USE_MAX_OPEN_COUNT = 1_000;

export type PackageCommandInput =
  | { kind: "PACKAGE_BAG" }
  | { kind: "PACKAGE_USE_HELP" }
  | { kind: "PACKAGE_USE"; bagNumber: number; openCount: number }
  | { kind: "INVALID"; reason: "FORMAT" | "BAG_NUMBER" | "OPEN_COUNT" };

// 패키지 명령만 부분 고도화 Dispatch 후보로 판별
export function isPackageCommandCandidate(message: string): boolean {
  return message === PACKAGE_BAG_COMMAND
    || message === PACKAGE_USE_COMMAND
    || /^\/패키지사용\s+\S+(?:\s+\S+)?$/.test(message);
}

// 동적 인자가 있는 패키지 사용 명령을 정확 일치 별칭으로 정규화
export function normalizePackageDispatchMessage(message: string): string {
  const parsed = parsePackageCommand(message);
  return parsed.kind === "PACKAGE_USE" || parsed.kind === "PACKAGE_USE_HELP" || parsed.kind === "INVALID"
    ? PACKAGE_USE_COMMAND
    : message;
}

// 패키지 명령 인자를 완전 일치 규칙으로 파싱
export function parsePackageCommand(message: string): PackageCommandInput {
  if (message === PACKAGE_BAG_COMMAND) return { kind: "PACKAGE_BAG" };
  if (message === PACKAGE_USE_COMMAND) return { kind: "PACKAGE_USE_HELP" };

  const match = /^\/패키지사용\s+(\d+)(?:\s+(\d+))?$/.exec(message);
  if (!match) return { kind: "INVALID", reason: "FORMAT" };

  const bagNumber = Number(match[1]);
  if (!Number.isSafeInteger(bagNumber) || bagNumber <= 0) {
    return { kind: "INVALID", reason: "BAG_NUMBER" };
  }

  const openCount = match[2] === undefined ? 1 : Number(match[2]);
  if (!Number.isSafeInteger(openCount) || openCount <= 0 || openCount > PACKAGE_USE_MAX_OPEN_COUNT) {
    return { kind: "INVALID", reason: "OPEN_COUNT" };
  }

  return { kind: "PACKAGE_USE", bagNumber, openCount };
}

// 패키지 사용법 안내 문구 생성
export function formatPackageUseHelp(): string {
  return [
    "📦 패키지 사용 방법",
    `${PACKAGE_USE_COMMAND} [가방번호] [오픈갯수]`,
    "",
    `예시: ${PACKAGE_USE_COMMAND} 1 3`,
    `오픈갯수를 생략하면 1개를 사용해요. 최대 ${PACKAGE_USE_MAX_OPEN_COUNT}개까지 입력할 수 있어요.`,
  ].join("\n");
}

// 잘못된 패키지 명령에 대한 안전한 안내 문구 생성
export function formatPackageCommandError(input: Extract<PackageCommandInput, { kind: "INVALID" }>): string {
  if (input.reason === "BAG_NUMBER") return "가방번호는 1 이상의 숫자로 입력해 주세요.";
  if (input.reason === "OPEN_COUNT") return `오픈갯수는 1~${PACKAGE_USE_MAX_OPEN_COUNT} 사이로 입력해 주세요.`;
  return formatPackageUseHelp();
}
