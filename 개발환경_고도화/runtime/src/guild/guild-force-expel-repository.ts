export interface GuildForceExpelActor { playerId: string; canForceExpel: boolean; }
export interface GuildForceExpelTarget { playerId: string; displayName: string; guildId: string | null; guildName: string | null; guildMark: string; roleCode: string | null; }
export interface GuildForceExpelResult { status: "ignored" | "failed" | "completed"; data?: string; guildId?: string; auditId?: string; outboxId?: string; }
export interface GuildForceExpelRecord { eventId: string; actorPlayerId: string; targetPlayerId: string; targetName: string; guildId: string; channelId: string; data: string; }
export interface GuildForceExpelTransaction {
  lockActor(externalUserId: string): Promise<GuildForceExpelActor | null>;
  readPriorResult(eventId: string, actorPlayerId: string): Promise<GuildForceExpelResult | null>;
  lockTarget(targetName: string): Promise<GuildForceExpelTarget | null>;
  startCommand(eventId: string, actorPlayerId: string, guildId: string): Promise<string>;
  removeMembership(guildId: string, targetPlayerId: string): Promise<void>;
  completeCommand(operationId: string, record: GuildForceExpelRecord): Promise<GuildForceExpelResult>;
}

// 강제제명의 권한·회원 잠금·멱등성·감사·outbox 경계를 제공합니다.
export interface GuildForceExpelRepository { runInTransaction<T>(work: (transaction: GuildForceExpelTransaction) => Promise<T>): Promise<T>; }
