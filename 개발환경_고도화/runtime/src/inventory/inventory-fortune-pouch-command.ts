export interface InventoryFortunePouchCommand {
  count: bigint | null;
  displayCount: string | null;
}

// v2.400의 broad startsWith 실행 경계를 그대로 판별합니다.
export function isInventoryFortunePouchCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && message.startsWith("/복주머니");
}

// broad 후보를 command registry의 대표 별칭으로 정규화합니다.
export function normalizeInventoryFortunePouchDispatchMessage(message: string): string {
  return isInventoryFortunePouchCommandCandidate(message) ? "/복주머니" : message;
}

// split(" ")·parseInt·Math.min의 v2.400 입력 특성을 보존합니다.
export function parseInventoryFortunePouchCommand(message: string): InventoryFortunePouchCommand | null {
  if (!isInventoryFortunePouchCommandCandidate(message)) return null;
  const args = message.split(" ");
  let count = 1;
  if (args.length > 1) count = Math.min(Number.parseInt(args[1]!), 10000);
  if (!Number.isFinite(count)) return { count: null, displayCount: null };
  return { count: BigInt(Math.trunc(count)), displayCount: String(count) };
}
