export interface InventoryWalletRngOpenCommand {
  requestedCount: bigint;
}

// v2.400의 exact 단일 명령과 숫자 일괄 명령만 dispatch 후보로 판별합니다.
export function isInventoryWalletRngOpenCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && /^\/지갑털기(?:$|\s+\d+\s*$)/.test(message);
}

// 숫자 인수가 붙은 입력을 command registry 대표 별칭으로 정규화합니다.
export function normalizeInventoryWalletRngOpenDispatchMessage(message: string): string {
  return isInventoryWalletRngOpenCommandCandidate(message) ? "/지갑털기" : message;
}

// v2.400의 기본 1회·0 입력 1회 보정 계약을 해석합니다.
export function parseInventoryWalletRngOpenCommand(message: string): InventoryWalletRngOpenCommand | null {
  if (message === "/지갑털기") return { requestedCount: 1n };
  const match = /^\/지갑털기\s+(\d+)\s*$/.exec(message);
  if (match === null) return null;
  const parsed = BigInt(match[1]!);
  return { requestedCount: parsed < 1n ? 1n : parsed };
}
