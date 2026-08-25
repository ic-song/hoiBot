export interface BagSellInput {
  providerCode: string;
  externalUserId: string;
  channelId: string;
  eventId: string;
  message: string;
}

export interface ParsedBagSellCommand {
  displaySeq: number;
  quantity: bigint | null;
}

export interface BagSellResult {
  status:
    | "invalid_command"
    | "identity_not_found"
    | "snapshot_required"
    | "stale_snapshot"
    | "item_not_sellable"
    | "insufficient_quantity"
    | "sold";
  data: string;
  playerId?: string;
  snapshotId?: string;
  definitionId?: string;
  catalogObjectKey?: string | null;
  itemCode?: string;
  itemName?: string;
  quantity?: string;
  pointDelta?: string;
  pointBalance?: string;
  operationId?: string;
  outboxId?: string;
  replayed?: boolean;
}

export interface BagSellRepository {
  sell(input: BagSellInput & ParsedBagSellCommand): Promise<BagSellResult>;
}

export function isBagSellCommand(message: string | undefined): boolean {
  return message === "/판매" || (message !== undefined && /^\/판매\s+[1-9][0-9]*(?:\s+[0-9]+)?$/.test(message));
}

// mutation 명령의 전체 문자열만 허용하고 표시 순번과 선택 수량을 분리합니다.
export function parseBagSellCommand(message: string): ParsedBagSellCommand | null {
  const match = /^\/판매\s+([1-9][0-9]*)(?:\s+([0-9]+))?$/.exec(message);
  if (match === null) return null;
  return {
    displaySeq: Number(match[1]),
    quantity: match[2] === undefined ? null : BigInt(match[2])
  };
}
