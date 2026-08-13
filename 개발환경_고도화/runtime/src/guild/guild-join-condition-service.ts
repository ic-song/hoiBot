import { ApplicationError } from "../shared/application-error.js";
import { buildGuildJoinConditionChangedMessage, parseGuildJoinConditionCommand } from "./guild-join-condition-policy.js";
import type { GuildJoinConditionRepository, GuildJoinConditionResult } from "./guild-join-condition-repository.js";

export interface GuildJoinConditionCommandInput {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

// 길드가입조건 변경을 입력 검증 후 멱등 트랜잭션으로 처리합니다.
export class GuildJoinConditionService {
  constructor(private readonly repository: GuildJoinConditionRepository) {}

  // 레거시 답장 형식을 유지하면서 정확한 명령만 실행합니다.
  async handle(command: GuildJoinConditionCommandInput): Promise<GuildJoinConditionResult> {
    const parsed = parseGuildJoinConditionCommand(command.message);
    if (parsed.kind === "ignored") return { status: "ignored" };
    if (parsed.kind === "usage") {
      return { status: "failed", data: "사용법: /길드가입조건 숫자\n예) /길드가입조건 100000" };
    }
    if (parsed.kind === "invalid") {
      return { status: "failed", data: "❌ 가입조건 숫자가 올바르지 않습니다." };
    }

    return this.repository.runInTransaction(async (transaction) => {
      const actor = await transaction.lockActor(command.externalUserId);
      if (actor === null) throw new ApplicationError("GUILD_MEMBERSHIP_REQUIRED", "❌ 가입된 길드가 없습니다.", 404);
      const prior = await transaction.readPriorResult(command.eventId, actor.playerId);
      if (prior !== null) return prior;
      if (!actor.canManageJoinCondition) {
        throw new ApplicationError("GUILD_JOIN_CONDITION_PERMISSION_REQUIRED", "❌ 길드마스터만 가입조건을 설정할 수 있습니다.", 403);
      }

      const operationId = await transaction.startCommand(command.eventId, actor.playerId, actor.guildId);
      const previousExperience = await transaction.updateJoinRequirement(actor.guildId, parsed.experience);
      const data = buildGuildJoinConditionChangedMessage(parsed.experience);
      return transaction.completeCommand(operationId, {
        eventId: command.eventId,
        playerId: actor.playerId,
        guildId: actor.guildId,
        channelId: command.channelId,
        data,
        previousExperience,
        experience: parsed.experience
      });
    });
  }
}
