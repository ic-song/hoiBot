export interface BagItemView {
  definitionId?: string;
  itemCode?: string;
  stackVersion?: string;
  catalogObjectKey?: string | null;
  displayName: string;
  quantity: string;
  legacyBagOrder: number | null;
}

export interface BagView {
  playerId: string;
  snapshotId?: string;
  ownerLabel: string;
  advertisement: string;
  items: BagItemView[];
}

export interface BagRepository {
  findByExternalIdentity(providerCode: string, externalUserId: string): Promise<BagView | null>;
}
