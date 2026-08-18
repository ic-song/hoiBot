import type { ParsedMinipetPackageGrant } from "./minipet-package-grant-policy.js";

export interface MinipetPackageGrantCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface MinipetPackageGrantStoredResult {
  status: "granted";
  operatorId: string;
  playerId: string;
  commandCode: string;
  itemCode: string;
  itemName: string;
  targetName: string;
  quantityDelta: string;
  quantityBefore: string;
  quantityAfter: string;
  data: string;
  outboxId: string;
  auditId: string;
  duplicate?: boolean;
}

export interface MinipetPackageGrantTransaction {
  findAuthorizedOperator(externalUserId: string): Promise<string | null>;
  findStoredResult(scope: string, key: string): Promise<MinipetPackageGrantStoredResult | null>;
  grant(operatorId: string, scope: string, key: string, command: MinipetPackageGrantCommand,
    parsed: ParsedMinipetPackageGrant): Promise<MinipetPackageGrantStoredResult | null>;
}

export interface MinipetPackageGrantRepository {
  withTransaction<T>(work: (transaction: MinipetPackageGrantTransaction) => Promise<T>): Promise<T>;
}
