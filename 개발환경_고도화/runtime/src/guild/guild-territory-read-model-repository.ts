export type GuildTerritoryProjectionState = "active" | "pending" | "no-war";

export interface GuildTerritorySeasonPin {
  seasonId: string;
  snapshotVersion: bigint;
}

export interface GuildTerritoryRulePin {
  territoryScope: string;
  ruleVersion: bigint;
}

export interface GuildTerritoryGuildProjection {
  guildId: string;
  displayName: string | null;
  mark: string | null;
}

export interface GuildTerritoryPlayerProjection {
  playerId: string;
  displayName: string;
}

export interface GuildTerritoryTurnVisibility {
  visible: boolean;
  userEliminated: boolean;
  guildEliminated: boolean;
  exclusionReasonCode: string | null;
  projectionIssue: "missing-player" | "missing-guild" | null;
}

export interface GuildTerritorySeasonProjection {
  state: GuildTerritoryProjectionState;
  season: null | {
    seasonId: string;
    seasonKey: string;
    snapshotVersion: bigint | null;
    startsAt: string | null;
    endsAt: string | null;
  };
}

export interface GuildTerritoryTurnOrderEntry {
  ordinal: number;
  guild: GuildTerritoryGuildProjection | null;
  player: GuildTerritoryPlayerProjection | null;
  visibility: GuildTerritoryTurnVisibility;
  turnState: "active" | "pending" | "completed" | "skipped";
  scheduledAt: string | null;
}

export interface GuildTerritoryRankingEntry {
  ordinal: number;
  guild: GuildTerritoryGuildProjection | null;
  score: bigint;
  lastScoredAt: string;
}

export interface GuildTerritoryRewardTier {
  rankFrom: number;
  rankTo: number;
  reward: unknown;
  guideText: string;
}

export interface GuildTerritoryRewardGuide {
  pin: GuildTerritoryRulePin;
  effectiveFrom: string | null;
  tiers: GuildTerritoryRewardTier[];
}

export interface GuildTerritoryRememberPreference {
  territoryScope: string;
  operatorPlayerId: string;
  playerId: string;
  desiredState: boolean;
  version: bigint;
}

export interface GuildTerritoryReadRequest {
  territoryScope: string;
  seasonPin?: GuildTerritorySeasonPin;
  rulePin?: GuildTerritoryRulePin;
  remember?: { operatorPlayerId: string; playerId: string };
}

export interface GuildTerritoryReadModel {
  season: GuildTerritorySeasonProjection;
  pin: GuildTerritorySeasonPin | null;
  turnOrder: GuildTerritoryTurnOrderEntry[];
  rankingSnapshot: null | {
    pin: GuildTerritorySeasonPin;
    rulePin: GuildTerritoryRulePin;
    capturedAt: string;
    entries: GuildTerritoryRankingEntry[];
  };
  rewardGuide: GuildTerritoryRewardGuide | null;
  rememberPreference: GuildTerritoryRememberPreference | null;
}

export interface SetGuildTerritoryRememberPreference {
  territoryScope: string;
  operatorPlayerId: string;
  playerId: string;
  desiredState: boolean;
}

// Territory projection reads share one consistent transaction; preference writes use a separate single-row transaction.
export interface GuildTerritoryReadModelRepository {
  readConsistent(request: GuildTerritoryReadRequest): Promise<GuildTerritoryReadModel>;
  setRememberPreference(command: SetGuildTerritoryRememberPreference): Promise<GuildTerritoryRememberPreference>;
}
