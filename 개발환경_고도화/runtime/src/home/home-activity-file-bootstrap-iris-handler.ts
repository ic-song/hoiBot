import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isHomeActivityFileBootstrapCommand } from "./home-activity-file-bootstrap-command.js";
import { HomeActivityFileBootstrapService } from "./home-activity-file-bootstrap-service.js";

// 운영자용 펫홈 활동 저장소 bootstrap을 MariaDB transaction에 연결합니다.
export class HomeActivityFileBootstrapIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(event: NormalizedIrisEvent): Promise<{ message: string; replayed: boolean; outboxId: string }> {
    if (!isHomeActivityFileBootstrapCommand(event.message)) throw new ApplicationError("HOME_ACTIVITY_BOOTSTRAP_COMMAND_INVALID", "펫홈 활동 파일 생성 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) throw new ApplicationError("HOME_ACTIVITY_BOOTSTRAP_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    const result = await new HomeActivityFileBootstrapService(this.database).execute({ eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId });
    return { message: result.message, replayed: result.replayed, outboxId: result.outboxId };
  }
}
