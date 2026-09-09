import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isLegacyLikeCommandCandidate } from "./legacy-like-command.js";
import { LegacyLikeService } from "./legacy-like-service.js";

// Iris 레거시 좋아요 명령 묶음을 하나의 DB aggregate service에 연결합니다.
export class LegacyLikeIrisHandler {
  constructor(private readonly database: DatabaseClient) {}
  async execute(event: NormalizedIrisEvent): Promise<{ message: string; room: string; replayed: boolean; outboxId: string }> {
    if (!isLegacyLikeCommandCandidate(event.message)) throw new ApplicationError("LEGACY_LIKE_COMMAND_INVALID", "좋아요 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) throw new ApplicationError("LEGACY_LIKE_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    const result = await new LegacyLikeService(this.database).execute({ eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId, message: event.message! });
    return { message: result.message, room: event.channelId, replayed: result.replayed, outboxId: result.outboxId };
  }
}
