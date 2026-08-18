import type { StarterPackageDefinition, StarterRewardDefinition } from "./starter-package-open-policy.js";

export interface StarterPackageActor { identityId: string; playerId: string; rankLabel: string; }
export interface StarterPackageItemState { itemId: string; quantity: bigint; version: bigint | null; stackExists: boolean; }
export interface StarterPackageLockedState {
  items: ReadonlyMap<string, StarterPackageItemState>;
  pointBalance: bigint;
  pointVersion: bigint;
}
export interface StarterPackageCatalog {
  packageId: string;
  definition: StarterPackageDefinition;
  rewards: readonly StarterRewardDefinition[];
}
export interface StarterPackageCommandRecord { externalUserId: string; channelId: string; message: string; eventId: string; }
export interface StarterPackageStoredResult {
  status: "opened" | "package_required";
  playerId: string;
  commandCode: string;
  stage: number;
  data: string;
  outboxId: string;
  auditId: string;
  packageBefore: string;
  packageAfter: string;
  pointBefore: string;
  pointAfter: string;
  rewards: Array<{ code: string; displayName: string; quantity: string }>;
  duplicate?: boolean;
}

export interface StarterPackageOpenTransaction {
  findActor(externalUserId: string): Promise<StarterPackageActor | null>;
  findStoredResult(scope: string, key: string): Promise<StarterPackageStoredResult | null>;
  isCastleSiegeActive(): Promise<boolean>;
  lockCatalog(definition: StarterPackageDefinition): Promise<StarterPackageCatalog>;
  lockState(actor: StarterPackageActor, catalog: StarterPackageCatalog): Promise<StarterPackageLockedState>;
  persistRequired(actor: StarterPackageActor, scope: string, key: string, command: StarterPackageCommandRecord,
    catalog: StarterPackageCatalog, state: StarterPackageLockedState, data: string): Promise<StarterPackageStoredResult>;
  persistOpened(actor: StarterPackageActor, scope: string, key: string, command: StarterPackageCommandRecord,
    catalog: StarterPackageCatalog, state: StarterPackageLockedState, data: string): Promise<StarterPackageStoredResult>;
}

export interface StarterPackageOpenRepository {
  withTransaction<T>(work: (transaction: StarterPackageOpenTransaction) => Promise<T>): Promise<T>;
}
