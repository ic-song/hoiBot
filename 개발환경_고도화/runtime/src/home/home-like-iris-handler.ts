import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isHomeLikeCommandCandidate } from "./home-like-command.js";
import { HomeLikeService } from "./home-like-service.js";

// Iris 좋아홈 세 명령을 하나의 DB aggregate service에 연결합니다.
export class HomeLikeIrisHandler {
  constructor(private readonly database: DatabaseClient) {}
  async execute(event: NormalizedIrisEvent): Promise<{ message: string; room: string; replayed: boolean; outboxId: string }> {
    if (!isHomeLikeCommandCandidate(event.message)) throw new ApplicationError("HOME_LIKE_COMMAND_INVALID", "좋아홈 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) throw new ApplicationError("HOME_LIKE_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    const result = await new HomeLikeService(this.database).execute({ eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId, message: event.message! });
    return { message: result.message, room: event.channelId, replayed: result.replayed, outboxId: result.outboxId };
  }
}
