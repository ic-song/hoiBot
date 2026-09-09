export const LEGENDARY_STONE_DRAW_COMMAND = "/전돌뽑기";

export type LegendaryStoneDrawCommand =
  | { kind: "draw"; count: bigint }
  | { kind: "usage" }
  | { kind: "limit" };

// 명령 토큰 뒤 공백으로 시작하는 입력만 후보로 인정해 prefix 충돌을 막습니다.
export function isLegendaryStoneDrawCommandCandidate(message: string | undefined): boolean {
  return typeof message === "string" && /^\/전돌뽑기(?:\s|$)/.test(message);
}

// 레거시 기본 1회와 1~100회 숫자 입력 및 안내 분기를 보존합니다.
export function parseLegendaryStoneDrawCommand(message: string): LegendaryStoneDrawCommand | undefined {
  if (!isLegendaryStoneDrawCommandCandidate(message)) return undefined;
  if (/^\/전돌뽑기\s*$/.test(message)) return { kind: "draw", count: 1n };
  const match = /^\/전돌뽑기\s+(\d+)\s*$/.exec(message);
  if (match === null) return { kind: "usage" };
  const count = BigInt(match[1]!);
  if (count <= 0n) return { kind: "usage" };
  if (count > 100n) return { kind: "limit" };
  return { kind: "draw", count };
}

// 수량형 입력도 exact command registry 항목으로 라우팅합니다.
export function normalizeLegendaryStoneDrawDispatchMessage(message: string): string {
  return isLegendaryStoneDrawCommandCandidate(message) ? LEGENDARY_STONE_DRAW_COMMAND : message;
}
