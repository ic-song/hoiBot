import type { DatabaseClient } from "../database.js";
import { CombineAllService, readCombineAllVariant } from "../crafting/combine-all-service.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../dispatch/command-dispatcher.js";
import { isQuestRewardClaimCommand, QuestRewardClaimService } from "../quest/quest-reward-claim-service.js";
import { ApplicationError } from "../shared/application-error.js";
import { isOpenAllCommand } from "./open-all-policy.js";
import { OpenAllService } from "./open-all-service.js";
import { MariaOpenAllRepository } from "./maria-open-all-repository.js";
import { InventoryCleanupOrchestrationService, isInventoryCleanupCommand } from "./inventory-cleanup-orchestration-service.js";

export interface InventoryCleanupIrisReply { outboxId: string; room: string; data: string; }

// 퀘스트 보상과 /정리 후보를 거대한 app callback 밖에서 분기합니다.
export class InventoryCleanupIrisHandler {
  constructor(private readonly database: DatabaseClient) {}

  async execute(event: { userId?: string; channelId?: string; message?: string; eventId: string }, queueError: (code: string, message: string) => Promise<InventoryCleanupIrisReply>): Promise<InventoryCleanupIrisReply | null> {
    if (event.userId === undefined || event.channelId === undefined) return null;
    if (isOpenAllCommand(event.message)) {
      try {
        const result = await new OpenAllService(new MariaOpenAllRepository(this.database)).handle({ externalUserId: event.userId, channelId: event.channelId, message: event.message!, eventId: event.eventId });
        return result.status === "opened" && !result.duplicate && result.outboxId !== undefined ? { outboxId: result.outboxId, room: event.channelId, data: result.data } : null;
      } catch (error) {
        if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) return queueError("open_all_error", error.message);
        throw error;
      }
    }
    const combineVariant = readCombineAllVariant(event.message);
    if (combineVariant !== null) {
      try {
        const result = await new CombineAllService(this.database).handle({ externalUserId: event.userId, channelId: event.channelId, message: event.message!, eventId: event.eventId });
        return result.status === "crafted" && result.outboxId !== undefined && result.data ? { outboxId: result.outboxId, room: event.channelId, data: result.data } : null;
      } catch (error) {
        if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) return queueError(combineVariant === "primary" ? "combine_all_error" : "combine_all_2_error", error.message);
        throw error;
      }
    }
    if (isQuestRewardClaimCommand(event.message)) {
      if (!await this.isModern(event)) return null;
      const result = await new QuestRewardClaimService(this.database).handle({ externalUserId: event.userId, channelId: event.channelId, message: event.message!, eventId: event.eventId });
      return result?.outboxId !== undefined && result.data ? { outboxId: result.outboxId, room: event.channelId, data: result.data } : null;
    }
    if (isInventoryCleanupCommand(event.message)) {
      if (!await this.isModern(event)) return null;
      const result = await new InventoryCleanupOrchestrationService(this.database).handle({ externalUserId: event.userId, channelId: event.channelId, message: event.message!, eventId: event.eventId });
      return result.outboxId !== undefined && result.data ? { outboxId: result.outboxId, room: event.channelId, data: result.data } : null;
    }
    return null;
  }

  private async isModern(event: { userId?: string; message?: string; eventId: string }): Promise<boolean> {
    if (event.userId === undefined || event.message === undefined) return false;
    const decision = await new CommandDispatcher(new MariaCommandDispatchRepository(this.database), { enabled: true, allowAllCanaries: false, canaryUserIds: new Set() }).resolve({ eventId: event.eventId, message: event.message, userId: event.userId, hasTrustedDisplayName: true });
    return decision.route === "MODERN";
  }
}
