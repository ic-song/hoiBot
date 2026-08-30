export type MiniPetCollectionTitleOwnerAction = "grant" | "select" | "remove";

export interface MiniPetCollectionLegacyTitle {
  sourceRow: number;
  listIndex: number;
  name: string;
  inDate: string;
  price: string;
}

export interface MiniPetCollectionTitleOwnerInput {
  eventId: string;
  playerId: string;
  action: MiniPetCollectionTitleOwnerAction;
  sourceRow?: number;
  listIndex?: number;
  legacy?: MiniPetCollectionLegacyTitle;
  expectedVersion?: string;
}

export interface MiniPetCollectionTitleOwnerResult {
  status: "granted" | "repeated" | "selected" | "removed";
  playerId: string;
  sourceRow: number;
  listIndex: number;
  titleId: string;
  instanceId: string;
  version: string;
  replayed: boolean;
}

export interface MiniPetCollectionTitleCompatibilityRow extends MiniPetCollectionLegacyTitle {
  source: "canonical" | "legacy";
  titleId?: string;
  instanceId?: string;
  lifecycle: "OWNED" | "REMOVED";
  selected: boolean;
  version?: string;
}

export type MiniPetCollectionTitleTransaction = DatabaseTransaction;
export type MiniPetCollectionTitleDatabase = DatabaseClient;

export interface MiniPetCollectionTitleOwnerRepository {
  execute(
    transaction: MiniPetCollectionTitleTransaction,
    operationId: string,
    input: MiniPetCollectionTitleOwnerInput,
  ): Promise<MiniPetCollectionTitleOwnerResult>;
  readCompatibility(
    transaction: MiniPetCollectionTitleTransaction,
    playerId: string,
    legacyTitles: readonly MiniPetCollectionLegacyTitle[],
  ): Promise<MiniPetCollectionTitleCompatibilityRow[]>;
}

export function miniPetCollectionTitleStableCode(sourceRow: number): string {
  if (!Number.isInteger(sourceRow) || sourceRow < 1 || sourceRow > 100) {
    throw new Error("MINI_PET_COLLECTION_SOURCE_ROW_INVALID");
  }
  return `MINI-PET-COLLECTION-TITLE-${String(sourceRow).padStart(3, "0")}`;
}

export class MiniPetCollectionTitleOwnerProvider {
  constructor(private readonly repository: MiniPetCollectionTitleOwnerRepository) {}

  execute(
    transaction: MiniPetCollectionTitleTransaction,
    operationId: string,
    input: MiniPetCollectionTitleOwnerInput,
  ): Promise<MiniPetCollectionTitleOwnerResult> {
    if (input.action === "grant") {
      if (!input.legacy || input.sourceRow !== input.legacy.sourceRow) {
        throw new Error("MINI_PET_COLLECTION_LEGACY_SOURCE_REQUIRED");
      }
      miniPetCollectionTitleStableCode(input.sourceRow);
    } else if (!Number.isInteger(input.listIndex) || Number(input.listIndex) < 1) {
      throw new Error("MINI_PET_COLLECTION_LIST_INDEX_INVALID");
    }
    return this.repository.execute(transaction, operationId, input);
  }

  readCompatibility(
    transaction: MiniPetCollectionTitleTransaction,
    playerId: string,
    legacyTitles: readonly MiniPetCollectionLegacyTitle[],
  ): Promise<MiniPetCollectionTitleCompatibilityRow[]> {
    legacyTitles.forEach((title) => miniPetCollectionTitleStableCode(title.sourceRow));
    return this.repository.readCompatibility(transaction, playerId, legacyTitles);
  }
}
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

