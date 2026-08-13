import type { GuildJoinCandidate } from "./guild-join-policy.js";

export interface GuildJoinPlayer {
  playerId: string;
  rankLabel: string;
  experience: bigint;
  currentGuildId: string | null;
  joinTicketQuantity: bigint;
}

export interface PendingGuildJoin {
  guildId: string;
  guildNo: number;
}

export interface GuildJoinResult {
  status: "ignored" | "pending" | "completed" | "cancelled" | "failed";
  data?: string;
  guildId?: string;
  auditId?: string;
  outboxId?: string;
}

export interface GuildJoinCommandRecord {
  eventId: string;
  commandCode: "guild_join_request" | "guild_join_confirm" | "guild_join_cancel";
  playerId: string;
  guildId: string | null;
  actionCode: "guild.join.requested" | "guild.join.completed" | "guild.join.cancelled" | "guild.join.invalidated";
  channelId: string;
  data: string;
  changeSummary: Record<string, unknown>;
}

export interface GuildJoinTransaction {
  lockPlayer(externalUserId: string): Promise<GuildJoinPlayer | null>;
  readPriorResult(eventId: string, commandCode: GuildJoinCommandRecord["commandCode"], playerId: string): Promise<GuildJoinResult | null>;
  startCommand(eventId: string, commandCode: GuildJoinCommandRecord["commandCode"], playerId: string): Promise<string>;
  listJoinableGuilds(): Promise<GuildJoinCandidate[]>;
  lockGuild(guildId: string): Promise<GuildJoinCandidate | null>;
  lockPendingJoin(playerId: string): Promise<PendingGuildJoin | null>;
  savePendingJoin(playerId: string, guildId: string, guildNo: number, eventId: string): Promise<void>;
  clearPendingJoin(playerId: string, status: "completed" | "cancelled" | "invalidated"): Promise<void>;
  addMembershipAndSpendTicket(operationId: string, playerId: string, guildId: string): Promise<void>;
  completeCommand(operationId: string, record: GuildJoinCommandRecord, result: GuildJoinResult): Promise<GuildJoinResult>;
}

// 길드가입의 잠금·멱등성·원장·outbox 경계를 하나의 DB 트랜잭션으로 제공합니다.
export interface GuildJoinRepository {
  runInTransaction<T>(work: (transaction: GuildJoinTransaction) => Promise<T>): Promise<T>;
}
