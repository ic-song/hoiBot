export interface BagItemView {
  displayName: string;
  quantity: string;
  legacyBagOrder: number | null;
}

export interface BagView {
  playerId: string;
  ownerLabel: string;
  advertisement: string;
  items: BagItemView[];
}

export interface BagRepository {
  findByExternalIdentity(providerCode: string, externalUserId: string): Promise<BagView | null>;
}
