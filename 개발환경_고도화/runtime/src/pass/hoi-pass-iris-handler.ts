import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isHoiPassCommandCandidate } from "./hoi-pass-command.js";
import { HoiPassService } from "./hoi-pass-service.js";

// Iris 호이패스 명령을 stable entitlement·inventory lifecycle에 연결합니다.
export class HoiPassIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(event: NormalizedIrisEvent): Promise<{ message: string; room: string; replayed: boolean; outboxId: string }> {
    if (!isHoiPassCommandCandidate(event.message)) throw new ApplicationError("HOI_PASS_COMMAND_INVALID", "호이패스 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) throw new ApplicationError("HOI_PASS_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    const result = await new HoiPassService(this.database).execute({ eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId, message: event.message! });
    return { message: result.data, room: event.channelId, replayed: result.replayed, outboxId: result.outboxId };
  }
}
