export interface GuildJoinConditionActor {
  playerId: string;
  guildId: string;
  canManageJoinCondition: boolean;
}

export interface GuildJoinConditionResult {
  status: "ignored" | "failed" | "completed";
  data?: string;
  guildId?: string;
  auditId?: string;
  outboxId?: string;
}

export interface GuildJoinConditionCommandRecord {
  eventId: string;
  playerId: string;
  guildId: string;
  channelId: string;
  data: string;
  previousExperience: bigint;
  experience: bigint;
}

export interface GuildJoinConditionTransaction {
  lockActor(externalUserId: string): Promise<GuildJoinConditionActor | null>;
  readPriorResult(eventId: string, playerId: string): Promise<GuildJoinConditionResult | null>;
  startCommand(eventId: string, playerId: string, guildId: string): Promise<string>;
  updateJoinRequirement(guildId: string, experience: bigint): Promise<bigint>;
  completeCommand(operationId: string, record: GuildJoinConditionCommandRecord): Promise<GuildJoinConditionResult>;
}

// 길드가입조건 변경의 잠금·멱등성·감사·outbox 경계를 한 트랜잭션으로 제공합니다.
export interface GuildJoinConditionRepository {
  runInTransaction<T>(work: (transaction: GuildJoinConditionTransaction) => Promise<T>): Promise<T>;
}
