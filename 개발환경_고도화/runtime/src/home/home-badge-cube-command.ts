export interface HomeBadgeCubeCommand {
  badgeNumber: number | null;
  optionNumber: number | null;
  tryCount: bigint | null;
  valid: boolean;
}

// 홈뱃지큐브 exact·인수 입력만 dispatch 후보로 판별합니다.
export function isHomeBadgeCubeCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && /^\/홈뱃지큐브(?:$|\s)/.test(message);
}

// 숫자 인수가 붙은 입력을 command registry 대표 별칭으로 정규화합니다.
export function normalizeHomeBadgeCubeDispatchMessage(message: string): string {
  return isHomeBadgeCubeCommandCandidate(message) ? "/홈뱃지큐브" : message;
}

// v2.400의 뱃지번호·옵션번호·기본 1회·최대 1,000회 계약을 해석합니다.
export function parseHomeBadgeCubeCommand(message: string): HomeBadgeCubeCommand | null {
  if (!isHomeBadgeCubeCommandCandidate(message)) return null;
  const match = /^\/홈뱃지큐브\s+(\d+)\s+([1-4])(?:\s+(\d+))?$/.exec(message);
  if (match === null) return { badgeNumber: null, optionNumber: null, tryCount: null, valid: false };
  const badgeNumber = Number.parseInt(match[1]!, 10);
  const optionNumber = Number.parseInt(match[2]!, 10);
  const tryCount = BigInt(match[3] ?? "1");
  return { badgeNumber, optionNumber, tryCount, valid: badgeNumber >= 1 && tryCount >= 1n && tryCount <= 1000n };
}
