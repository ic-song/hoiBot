import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isLegacyDataCleanupCommand } from "./legacy-data-cleanup-command.js";
import { LegacyDataCleanupService, type LegacyDataCleanupResult } from "./legacy-data-cleanup-service.js";

// Iris 관리자 identity를 원자적인 레거시 데이터 정리 서비스에 연결합니다.
export class LegacyDataCleanupIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(event: NormalizedIrisEvent): Promise<LegacyDataCleanupResult> {
    if (!event.userId || !event.channelId || !event.message) {
      throw new ApplicationError("LEGACY_DATA_CLEANUP_IDENTITY_REQUIRED", "관리자 식별 정보를 확인할 수 없습니다.", 401);
    }
    if (!isLegacyDataCleanupCommand(event.message)) {
      throw new ApplicationError("LEGACY_DATA_CLEANUP_COMMAND_INVALID", "데이터 정리 명령 형식이 올바르지 않습니다.", 422);
    }
    return new LegacyDataCleanupService(this.database).execute({
      eventId: event.eventId,
      externalUserId: event.userId,
      destinationId: event.channelId,
    });
  }
}
