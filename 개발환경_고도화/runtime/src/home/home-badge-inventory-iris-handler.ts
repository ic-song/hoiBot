import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isHomeBadgeInventoryCommand } from "./home-badge-inventory-command.js";
import { HomeBadgeInventoryService } from "./home-badge-inventory-service.js";

// Iris 홈뱃지 조회를 version-pinned inventory transaction에 연결합니다.
export class HomeBadgeInventoryIrisHandler {
  constructor(private readonly database: DatabaseClient) {}
  async execute(event: NormalizedIrisEvent): Promise<{ message: string; room: string; replayed: boolean; outboxId: string }> {
    if (!isHomeBadgeInventoryCommand(event.message)) throw new ApplicationError("HOME_BADGE_COMMAND_INVALID", "홈뱃지 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) throw new ApplicationError("HOME_BADGE_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    const result = await new HomeBadgeInventoryService(this.database).execute({
      eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId, message: event.message!
    });
    return { message: result.message, room: event.channelId, replayed: result.replayed, outboxId: result.outboxId };
  }
}
