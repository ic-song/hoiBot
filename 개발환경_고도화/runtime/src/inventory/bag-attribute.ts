export interface BagAttributeInput {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface ParsedBagAttributeCommand {
  targetName: string;
  itemNumber: number;
  itemCount: bigint;
}

export interface BagAttributeItem {
  itemId: bigint;
  itemCode: string;
  displayName: string;
  quantity: bigint;
  version: bigint;
  legacyBagOrder: number | null;
}

export interface BagAttributeResult {
  status: "ignored_forbidden" | "invalid_command" | "player_not_found" | "invalid_item_number" | "changed" | "deleted";
  data?: string;
  playerId?: string;
  itemCode?: string;
  itemName?: string;
  quantity?: string;
  quantityDelta?: string;
  outboxId?: string;
  auditId?: string;
}

export interface BagAttributeRepository {
  findAuthorizedOperator(externalUserId: string): Promise<string | null>;
  adjust(input: BagAttributeInput & ParsedBagAttributeCommand & { operatorId: string }): Promise<BagAttributeResult>;
}
