import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isHomeBadgePermanentDeleteCommand } from "./home-badge-permanent-delete-command.js";
import { HomeBadgePermanentDeleteService } from "./home-badge-permanent-delete-service.js";

// Iris 홈뱃지 영구삭제를 absolute tombstone transaction에 연결합니다.
export class HomeBadgePermanentDeleteIrisHandler {
  constructor(private readonly database: DatabaseClient) {}
  async execute(event: NormalizedIrisEvent): Promise<{ outboxId: string; room: string; message: string }> {
    if (!isHomeBadgePermanentDeleteCommand(event.message)) throw new ApplicationError("HOME_BADGE_DELETE_COMMAND_INVALID", "홈뱃지 삭제 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) throw new ApplicationError("HOME_BADGE_DELETE_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    const result = await new HomeBadgePermanentDeleteService(this.database).execute({
      eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId, message: event.message!
    });
    return { outboxId: result.outboxId, room: event.channelId, message: result.message };
  }
}
