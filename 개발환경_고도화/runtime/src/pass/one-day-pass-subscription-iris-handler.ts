import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isOneDayPassSubscriptionCommand } from "./one-day-pass-subscription-command.js";
import { OneDayPassSubscriptionService } from "./one-day-pass-subscription-service.js";

// Iris 원데이패스 구독 지급을 DB 보상 서비스에 연결합니다.
export class OneDayPassSubscriptionIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}
  public async execute(event: NormalizedIrisEvent): Promise<{ message: string; room: string; replayed: boolean; outboxId: string }> {
    if (!isOneDayPassSubscriptionCommand(event.message)) throw new ApplicationError("ONE_DAY_PASS_SUBSCRIPTION_COMMAND_INVALID", "원데이패스 구독 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) throw new ApplicationError("ONE_DAY_PASS_SUBSCRIPTION_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    const result = await new OneDayPassSubscriptionService(this.database).execute({ eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId });
    return { message: result.data, room: event.channelId, replayed: result.replayed, outboxId: result.outboxId };
  }
}
