import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isDebugModeCommand } from "./debug-mode-command.js";
import { DebugModeService, type DebugModeResult } from "./debug-mode-service.js";

// Iris 관리자 identity를 현재 프로세스의 공용 디버깅 모드 provider에 연결합니다.
export class DebugModeIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(event: NormalizedIrisEvent): Promise<DebugModeResult> {
    if (!event.userId || !event.channelId || !event.message) {
      throw new ApplicationError("DEBUG_MODE_IDENTITY_REQUIRED", "관리자 식별 정보를 확인할 수 없습니다.", 401);
    }
    if (!isDebugModeCommand(event.message)) {
      throw new ApplicationError("DEBUG_MODE_COMMAND_INVALID", "디버깅 모드 명령 형식이 올바르지 않습니다.", 422);
    }
    return new DebugModeService(this.database).execute({
      eventId: event.eventId,
      externalUserId: event.userId,
      destinationId: event.channelId,
    });
  }
}
