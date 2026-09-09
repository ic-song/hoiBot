import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isHomePassReformCleanupCommand } from "./home-pass-reform-cleanup-command.js";
import { HomePassReformCleanupService } from "./home-pass-reform-cleanup-service.js";

// 운영자용 펫홈 패스 개편 정리를 MariaDB transaction에 연결합니다.
export class HomePassReformCleanupIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(event: NormalizedIrisEvent): Promise<{ message: string; replayed: boolean; outboxId: string }> {
    if (!isHomePassReformCleanupCommand(event.message)) throw new ApplicationError("HOME_PASS_REFORM_CLEANUP_COMMAND_INVALID", "펫홈 패스 개편 정리 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) throw new ApplicationError("HOME_PASS_REFORM_CLEANUP_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    const result = await new HomePassReformCleanupService(this.database).execute({ eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId });
    return { message: result.message, replayed: result.replayed, outboxId: result.outboxId };
  }
}
