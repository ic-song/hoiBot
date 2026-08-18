export interface InventorySnapshotInput {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface InventorySnapshotResult {
  status: "ignored_forbidden" | "saved";
  data?: string;
  snapshotId?: string;
  playerCount?: string;
  itemCount?: string;
  quantityTotal?: string;
  contentHash?: string;
  outboxId?: string;
  auditId?: string;
}

export interface InventorySnapshotRepository {
  findAuthorizedOperator(externalUserId: string): Promise<string | null>;
  save(input: InventorySnapshotInput & { operatorId: string }): Promise<InventorySnapshotResult>;
}
