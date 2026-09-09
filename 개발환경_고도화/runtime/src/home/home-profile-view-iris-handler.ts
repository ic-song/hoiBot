import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isHomeProfileViewCandidate } from "./home-profile-view-command.js";
import { HomeProfileViewService } from "./home-profile-view-service.js";

// Iris 펫홈 조회를 DB projection과 방문 transaction에 연결합니다.
export class HomeProfileViewIrisHandler {
  constructor(private readonly database: DatabaseClient) {}
  async execute(event: NormalizedIrisEvent): Promise<{ message: string; room: string; replayed: boolean; outboxId: string }> {
    if (!isHomeProfileViewCandidate(event.message)) throw new ApplicationError("HOME_PROFILE_COMMAND_INVALID", "펫홈 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) throw new ApplicationError("HOME_PROFILE_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    const result = await new HomeProfileViewService(this.database).execute({ eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId, message: event.message! });
    return { message: result.messages.join("\n\n"), room: event.channelId, replayed: result.replayed, outboxId: result.outboxIds[0]! };
  }
}
