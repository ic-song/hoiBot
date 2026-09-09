import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { parseHomeFeedMutationCommand } from "./home-feed-mutate-command.js";
import { HomeFeedMutationService } from "./home-feed-mutate-service.js";

// Iris 피드 변경 명령을 단일 원자 service에 연결합니다.
export class HomeFeedMutationIrisHandler {
  constructor(private readonly db: DatabaseClient) {}
  async execute(event: NormalizedIrisEvent) {
    const command = parseHomeFeedMutationCommand(event.message ?? "");
    if (command === null) throw new ApplicationError("HOME_FEED_COMMAND_INVALID", "피드 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) throw new ApplicationError("HOME_FEED_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    const result = await new HomeFeedMutationService(this.db).execute({ eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId, command });
    return { message: result.message, room: event.channelId, replayed: result.replayed, outboxId: result.outboxId };
  }
}
