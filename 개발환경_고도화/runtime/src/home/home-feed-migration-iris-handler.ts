import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isHomeFeedMigrationCommand } from "./home-feed-migration-command.js";
import { HomeFeedMigrationService } from "./home-feed-migration-service.js";

// 운영자용 펫홈 피드 일괄 이관을 MariaDB transaction에 연결합니다.
export class HomeFeedMigrationIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(event: NormalizedIrisEvent): Promise<{ message: string; replayed: boolean; outboxId: string }> {
    if (!isHomeFeedMigrationCommand(event.message)) throw new ApplicationError("HOME_FEED_MIGRATION_COMMAND_INVALID", "펫홈 피드 마이그레이션 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) throw new ApplicationError("HOME_FEED_MIGRATION_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    const result = await new HomeFeedMigrationService(this.database).execute({ eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId });
    return { message: result.message, replayed: result.replayed, outboxId: result.outboxId };
  }
}
