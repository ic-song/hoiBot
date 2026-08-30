import type { DatabaseTransaction } from "../database.js";
import type { PassSemanticCode } from "./pass-code-resolver.js";

export type PassEntitlementKind = "permanent" | "dated";
export type PassOwnershipStatus = "active" | "revoked" | "expired";
export type PassOwnershipSource = "CANONICAL" | "COMPATIBILITY";

export interface PassOwnershipState {
  id: bigint | null;
  playerId: bigint;
  semanticCode: PassSemanticCode;
  entitlementKind: PassEntitlementKind;
  endDate: string | null;
  status: PassOwnershipStatus;
  version: bigint;
  source: PassOwnershipSource;
}

export interface CanonicalPassWrite {
  playerId: bigint;
  semanticCode: PassSemanticCode;
  entitlementKind: PassEntitlementKind;
  endDate: string | null;
  status: PassOwnershipStatus;
  operationId: bigint;
}

export interface PassCanonicalOwnershipRepository {
  readCanonical(transaction: DatabaseTransaction, playerId: bigint, semanticCode: PassSemanticCode, lock: boolean): Promise<PassOwnershipState | null>;
  readCompatibility(transaction: DatabaseTransaction, playerId: bigint, semanticCode: PassSemanticCode, lock: boolean): Promise<PassOwnershipState | null>;
  insertCanonical(transaction: DatabaseTransaction, write: CanonicalPassWrite): Promise<bigint>;
  updateCanonical(transaction: DatabaseTransaction, id: bigint, expectedVersion: bigint, write: CanonicalPassWrite): Promise<boolean>;
  writeCompatibility(transaction: DatabaseTransaction, write: CanonicalPassWrite): Promise<void>;
}
