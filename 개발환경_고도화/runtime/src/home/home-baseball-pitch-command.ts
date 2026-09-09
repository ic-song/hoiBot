export const HOME_BASEBALL_PITCH_COMMAND = "/투수던집니다";

export type HomeBaseballPitchCommand =
  | { kind: "use"; count: bigint }
  | { kind: "usage" }
  | { kind: "limit" };

// 명령 토큰 뒤 공백으로 시작하는 입력만 후보로 인정해 prefix 충돌을 막습니다.
export function isHomeBaseballPitchCommandCandidate(message: string | undefined): boolean {
  return typeof message === "string" && /^\/투수던집니다(?:\s|$)/.test(message);
}

// 레거시 기본 1회와 1~100회 숫자 입력 및 안내 분기를 보존합니다.
export function parseHomeBaseballPitchCommand(message: string): HomeBaseballPitchCommand | undefined {
  if (!isHomeBaseballPitchCommandCandidate(message)) return undefined;
  if (/^\/투수던집니다\s*$/.test(message)) return { kind: "use", count: 1n };
  const match = message.match(/^\/투수던집니다\s+(\d+)\s*$/);
  if (match === null) return { kind: "usage" };
  const count = BigInt(match[1]!);
  if (count <= 0n) return { kind: "usage" };
  if (count > 100n) return { kind: "limit" };
  return { kind: "use", count };
}

export function normalizeHomeBaseballPitchDispatchMessage(message: string): string {
  return isHomeBaseballPitchCommandCandidate(message) ? HOME_BASEBALL_PITCH_COMMAND : message;
}
