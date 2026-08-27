import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isHomeSocialBadgeMigrationCommand } from "./home-social-badge-migration-command.js";
import { HomeSocialBadgeMigrationService } from "./home-social-badge-migration-service.js";

// 운영자용 펫홈 소셜 통계·업적 뱃지 이관을 MariaDB transaction에 연결합니다.
export class HomeSocialBadgeMigrationIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(event: NormalizedIrisEvent): Promise<{ message: string; replayed: boolean; outboxId: string }> {
    if (!isHomeSocialBadgeMigrationCommand(event.message)) {
      throw new ApplicationError("HOME_SOCIAL_BADGE_MIGRATION_COMMAND_INVALID", "펫홈 소셜·뱃지 마이그레이션 명령 형식을 확인해 주세요.", 422);
    }
    if (!event.userId || !event.channelId) {
      throw new ApplicationError("HOME_SOCIAL_BADGE_MIGRATION_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    }
    const result = await new HomeSocialBadgeMigrationService(this.database).execute({
      eventId: event.eventId,
      externalUserId: event.userId,
      destinationId: event.channelId,
    });
    return { message: result.message, replayed: result.replayed, outboxId: result.outboxId };
  }
}
