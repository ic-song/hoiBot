import { ApplicationError } from "../shared/application-error.js";
import { buildGuildForceExpelCompletedMessage, parseGuildForceExpelCommand } from "./guild-force-expel-policy.js";
import type { GuildForceExpelRepository, GuildForceExpelResult } from "./guild-force-expel-repository.js";

export interface GuildForceExpelInput { externalUserId: string; channelId: string; message: string; eventId: string; }

// 마스터 권한 사용자의 길드 강제제명을 멱등 트랜잭션으로 처리합니다.
export class GuildForceExpelService {
  constructor(private readonly repository: GuildForceExpelRepository) {}

  // 입력·권한·대상 회원·길드마스터 보호를 확인한 뒤 회원 관계를 삭제합니다.
  async handle(command: GuildForceExpelInput): Promise<GuildForceExpelResult> {
    const parsed = parseGuildForceExpelCommand(command.message);
    if (parsed.kind === "ignored") return { status: "ignored" };
    if (parsed.kind === "usage") return { status: "failed", data: "사용법: /길드강제제명 닉네임" };
    return this.repository.runInTransaction(async (transaction) => {
      const actor = await transaction.lockActor(command.externalUserId);
      if (actor === null || !actor.canForceExpel) throw new ApplicationError("MASTER_PERMISSION_REQUIRED", "❌ 마스터권한 사용자만 사용할 수 있습니다.", 403);
      const prior = await transaction.readPriorResult(command.eventId, actor.playerId);
      if (prior !== null) return prior;
      const target = await transaction.lockTarget(parsed.targetName);
      if (target === null) throw new ApplicationError("PLAYER_NOT_FOUND", "❌ 존재하지 않는 유저입니다.", 404);
      if (target.guildId === null) throw new ApplicationError("TARGET_GUILD_MEMBERSHIP_REQUIRED", "❌ 해당 유저는 길드에 가입되어 있지 않습니다.", 409);
      if (target.guildName === null) throw new ApplicationError("GUILD_DATA_ERROR", "❌ 길드 데이터 오류.", 409);
      const roleCode = target.roleCode?.toLowerCase() ?? "";
      if (roleCode === "leader" || roleCode === "master") throw new ApplicationError("GUILD_MASTER_EXPEL_FORBIDDEN", "❌ 길드마스터는 강제제명할 수 없습니다.", 409);
      const operationId = await transaction.startCommand(command.eventId, actor.playerId, target.guildId);
      await transaction.removeMembership(target.guildId, target.playerId);
      const data = buildGuildForceExpelCompletedMessage(target.displayName, target.guildName, target.guildMark);
      return transaction.completeCommand(operationId, { eventId: command.eventId, actorPlayerId: actor.playerId, targetPlayerId: target.playerId,
        targetName: target.displayName, guildId: target.guildId, channelId: command.channelId, data });
    });
  }
}
