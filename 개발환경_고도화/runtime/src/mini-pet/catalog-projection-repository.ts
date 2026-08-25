export type MiniPetEnvironmentCode = "prod" | "dev";
export type MiniPetProjectionCode =
  | "catalog" | "inventory" | "equipped_rank" | "admin_info"
  | "collection" | "grade_stats" | "draw_rates";

export interface MiniPetCatalogEntry {
  definitionId: string;
  definitionCode: string;
  name: string;
  gradeCode: string;
  grade: string;
  emoji: string;
  sourceOrder: number;
  filterKey: string;
  rawProbability: string | null;
  normalizedRate: string | null;
  allowed: boolean;
}

export interface OwnedMiniPetProjection {
  ownedId: string;
  playerId: string;
  definitionId: string;
  definitionCode: string;
  name: string;
  grade: string;
  emoji: string;
  experience: string;
  equipped: boolean;
  displayOrder: number;
  rank: number;
  ownerDisplayName: string;
  ownerCheckRank: string;
  snapshotVersion: string;
}

export interface MiniPetCollectionProjection {
  definitionId: string; definitionCode: string; name: string; grade: string;
  registered: boolean; stage: number; completedStage: number; repairRequired: boolean;
}

export interface MiniPetPublishedSnapshotInput {
  environmentCode: MiniPetEnvironmentCode;
  poolVersion: string;
  catalogKind: "draw_rate" | "fixed_reward";
  definitionVersion: string;
  ownedSnapshotVersion: string;
  snapshotAt: string;
  gradeTable: Record<string, string>;
  allowedGrades: string[];
  stageRewards: Record<string, unknown>;
  entries: MiniPetCatalogEntry[];
  publisherExternalUserId: string;
}

export interface MiniPetReadResult {
  projectionCode: MiniPetProjectionCode;
  environmentCode: MiniPetEnvironmentCode;
  poolVersion: string;
  definitionVersion: string;
  ownedSnapshotVersion: string;
  snapshotAt: string;
  zeroTotal: boolean;
  totalRawProbability: string;
  totalNormalizedRate: string;
  capacity: number;
  catalog: MiniPetCatalogEntry[];
  owned: OwnedMiniPetProjection[];
  gradeAggregate: Array<{ grade: string; count: number; percentage: string }>;
  gradeTotalCount: number;
  allowedGrades: string[];
  gradeTable: Record<string, string>;
  stageRewards: Record<string, unknown>;
  collection: MiniPetCollectionProjection[];
  collectionGrades: Array<{ grade: string; registered: boolean }>;
  collectionRepairRequired: boolean;
  adminLegacySnapshot?: Record<string, unknown>;
  targetDisplayName?: string;
  outboxId?: string;
  auditId: string;
}

export interface MiniPetReadInput {
  projectionCode: MiniPetProjectionCode;
  environmentCode: MiniPetEnvironmentCode;
  poolVersion: string;
  snapshotAt: string;
  providerEventId: string;
  requestHash: string;
  viewerExternalUserId?: string;
  targetPlayerId?: string;
  replyDestinationId?: string;
  requestChannelId?: string;
}

export interface MiniPetSnapshotPin {
  poolVersion: string;
  snapshotAt: string;
}

export interface MiniPetTargetPlayer {
  playerId: string;
  displayName: string;
}

export interface MiniPetCatalogProjectionRepository {
  resolveLatestSnapshotPin(environmentCode: MiniPetEnvironmentCode): Promise<MiniPetSnapshotPin>;
  resolveLatestCollectionSnapshotPin(environmentCode: MiniPetEnvironmentCode): Promise<MiniPetSnapshotPin>;
  resolveTargetPlayer(environmentCode: MiniPetEnvironmentCode, poolVersion: string, snapshotAt: string, targetName: string): Promise<MiniPetTargetPlayer>;
  read(input: MiniPetReadInput): Promise<MiniPetReadResult>;
  publishSnapshot(input: MiniPetPublishedSnapshotInput): Promise<{ poolVersion: string; definitionVersion: string; snapshotAt: string }>;
}
