import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isLegendaryStoneDrawCommandCandidate } from "./legendary-stone-draw-command.js";
import { LegendaryStoneDrawService } from "./legendary-stone-draw-service.js";

// 전돌뽑기 명령을 원자 티켓 소비·보상 transaction에 연결합니다.
export class LegendaryStoneDrawIrisHandler {
  public constructor(private readonly database: DatabaseClient, private readonly broadcastIds: readonly string[] = []) {}

  public async execute(event: NormalizedIrisEvent): Promise<Array<{ message: string; room: string; replayed: boolean; outboxId: string }>> {
    if (!isLegendaryStoneDrawCommandCandidate(event.message)) throw new ApplicationError("LEGENDARY_STONE_DRAW_COMMAND_INVALID", "전돌뽑기 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) throw new ApplicationError("LEGENDARY_STONE_DRAW_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    const result = await new LegendaryStoneDrawService(this.database, Math.random, this.broadcastIds).execute({ eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId, message: event.message! });
    return result.replies.map(reply => ({ message: reply.message, room: reply.room, replayed: result.replayed, outboxId: reply.outboxId }));
  }
}
