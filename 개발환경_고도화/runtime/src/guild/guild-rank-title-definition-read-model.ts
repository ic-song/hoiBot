export interface GuildRankTitleDefinition {
  sourceRow: number;
  stableCode: string;
  displayName: string;
  minimumRank: number;
  maximumRank: number | null;
  policyCode: "GUILD_RANK_TITLE";
  policyVersion: 1;
  lifecycle: "ACTIVE";
}

export class GuildRankTitleDefinitionReadModel {
  constructor(private readonly definitions: readonly GuildRankTitleDefinition[]) {}

  list(): readonly GuildRankTitleDefinition[] {
    return this.definitions;
  }

  resolve(rank: number): GuildRankTitleDefinition | null {
    const matches = this.definitions.filter(
      (definition) =>
        rank >= definition.minimumRank &&
        (definition.maximumRank === null || rank <= definition.maximumRank),
    );
    if (matches.length > 1) {
      throw new Error(`overlapping guild rank title definitions for rank ${rank}`);
    }
    return matches[0] ?? null;
  }
}
