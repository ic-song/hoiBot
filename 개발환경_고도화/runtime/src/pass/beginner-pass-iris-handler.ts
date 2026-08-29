import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isBeginnerPassCommandCandidate } from "./beginner-pass-command.js";
import { BeginnerPassService } from "./beginner-pass-service.js";

// Iris 초보패스 명령을 stable registry와 자동탐험권 provider에 연결합니다.
export class BeginnerPassIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(event: NormalizedIrisEvent): Promise<{ message: string; room: string; replayed: boolean; outboxId: string }> {
    if (!isBeginnerPassCommandCandidate(event.message)) throw new ApplicationError("BEGINNER_PASS_COMMAND_INVALID", "초보패스 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) throw new ApplicationError("BEGINNER_PASS_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    const result = await new BeginnerPassService(this.database).execute({ eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId, message: event.message! });
    return { message: result.data, room: event.channelId, replayed: result.replayed, outboxId: result.outboxId };
  }
}
