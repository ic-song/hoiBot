import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isPassListCommandCandidate } from "./pass-list-command.js";
import { PassListService } from "./pass-list-service.js";

// Iris 패스목록 명령을 compatibility projection service에 연결합니다.
export class PassListIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}
  public async execute(event: NormalizedIrisEvent): Promise<{ message: string; room: string; replayed: boolean; outboxId: string }> {
    if (!isPassListCommandCandidate(event.message)) throw new ApplicationError("PASS_LIST_COMMAND_INVALID", "패스목록 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) throw new ApplicationError("PASS_LIST_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    const result = await new PassListService(this.database).execute({ eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId, message: event.message! });
    return { message: result.data, room: event.channelId, replayed: result.replayed, outboxId: result.outboxId };
  }
}
