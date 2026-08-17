export interface BagAddInput {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface ParsedBagAddCommand {
  targetName: string;
  itemName: string;
  itemCount: bigint;
}

export interface BagAddResult {
  status: "ignored_forbidden" | "invalid_command" | "player_not_found" | "added";
  data?: string;
  playerId?: string;
  itemCode?: string;
  itemName?: string;
  quantity?: string;
  quantityDelta?: string;
  outboxId?: string;
  auditId?: string;
}

export interface BagAddRepository {
  findAuthorizedOperator(externalUserId: string): Promise<string | null>;
  add(input: BagAddInput & ParsedBagAddCommand & { operatorId: string }): Promise<BagAddResult>;
}
