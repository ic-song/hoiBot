export type PackageDefinitionStatus = "DRAFT" | "READY" | "DEPRECATED";

export interface PackageCatalogEntry {
  id: string;
  catalogVersion: string;
  displayName: string;
  legacyCommand: string | null;
  consumeItemId: string;
  definitionStatus: PackageDefinitionStatus;
  enabled: boolean;
  maxOpenCount: number;
}

export interface PackageRewardEntry {
  packageId: string;
  rewardOrder: number;
  itemId: string;
  quantity: bigint;
  probability: number | null;
  targetSelector: string | null;
  metadataOverride: Readonly<Record<string, unknown>> | null;
}

export interface PackageCatalogSnapshot {
  version: string;
  packages: readonly PackageCatalogEntry[];
}
