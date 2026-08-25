export interface CastleBattleRankingEntry {
  rank: number;
  tier: string;
  displayName: string;
  score: bigint;
}

export interface CastleBattleRankingSnapshot {
  seasonKey: string;
  sourceVersion: string;
  snapshotVersion: string;
  entries: CastleBattleRankingEntry[];
}

export interface CastleBattleRankingResult {
  status: "completed";
  data: string;
  seasonKey: string | null;
  snapshotVersion: string | null;
  outboxId: string;
}

export interface CastleBattleRankingCommand {
  externalUserId: string;
  channelId: string;
  eventId: string;
}

export interface CastleBattleRankingRepository {
  read(command: CastleBattleRankingCommand, render: (snapshot: CastleBattleRankingSnapshot | null) => string): Promise<CastleBattleRankingResult>;
}
