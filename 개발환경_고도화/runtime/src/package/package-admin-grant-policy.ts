export const PACKAGE_ADMIN_GRANT_COMMAND_CODE = "CMD-06-0106";

export interface ParsedPackageAdminGrant {
  targetName: string;
  listNumber: bigint;
  count: bigint;
}

export type PackageAdminGrantParseResult =
  | { status: "parsed"; value: ParsedPackageAdminGrant }
  | { status: "invalid_count"; data: string };

const COUNT_ERROR = "❌ 지급 수량은 1 이상 10000 이하만 가능합니다.";

// Rhino의 원문 anchored guard를 그대로 판별합니다.
export function isPackageAdminGrantCommand(message: string | undefined): boolean {
  return message !== undefined && /^\/패키지지급\s+.+\s+\d+\s+\d+$/.test(message);
}

// 뒤의 두 숫자 토큰을 번호와 수량으로 읽고 대상 내부 공백을 한 칸으로 정규화합니다.
export function parsePackageAdminGrantCommand(message: string): PackageAdminGrantParseResult {
  const body = message.replace(/^\/패키지지급\s+/, "").trim();
  const parts = body.split(/\s+/);
  const count = BigInt(parts.pop()!);
  const listNumber = BigInt(parts.pop()!);
  if (count < 1n || count > 10000n) return { status: "invalid_count", data: COUNT_ERROR };
  return { status: "parsed", value: { targetName: parts.join(" "), listNumber, count } };
}

// 현행 관리자 지급 성공 응답의 줄바꿈과 필드 순서를 보존합니다.
export function buildPackageAdminGrantReply(input: {
  targetName: string;
  packageName: string;
  count: bigint;
  quantityBefore: bigint;
  quantityAfter: bigint;
  operatorName: string;
}): string {
  return [
    "✅ 패키지 지급 완료",
    "",
    `대상: ${input.targetName}`,
    `패키지: ${input.packageName}`,
    `지급 수량: ${input.count.toLocaleString("en-US")}개`,
    `보유 수량: ${input.quantityBefore.toLocaleString("en-US")}개 → ${input.quantityAfter.toLocaleString("en-US")}개`,
    `지급자: ${input.operatorName}`
  ].join("\n");
}

export const PACKAGE_ADMIN_GRANT_ERRORS = {
  packageNumber: "❌ 패키지 번호가 올바르지 않습니다.",
  packageName: "❌ 패키지명이 올바르지 않습니다.",
  packageDisabled: "❌ 비활성화된 패키지는 지급할 수 없습니다.",
  targetMissing: (target: string) => `❌ 대상 유저가 존재하지 않습니다: ${target}`
} as const;
