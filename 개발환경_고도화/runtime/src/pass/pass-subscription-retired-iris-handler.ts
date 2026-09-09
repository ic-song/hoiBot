import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { parsePassSubscriptionRetiredCommand, PassSubscriptionRetiredCommandService } from "./pass-subscription-retired-command-service.js";

// Iris retired 패스 구독 명령을 무변경 안내 서비스에 연결합니다.
export class PassSubscriptionRetiredIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}
  public async execute(event: NormalizedIrisEvent): Promise<{ message: string; room: string; replayed: boolean; outboxId: string }> {
    const command = parsePassSubscriptionRetiredCommand(event.message ?? "");
    if (!command) throw new ApplicationError("PASS_SUBSCRIPTION_RETIRED_COMMAND_INVALID", "패스 구독 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) throw new ApplicationError("PASS_SUBSCRIPTION_RETIRED_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    const result = await new PassSubscriptionRetiredCommandService(this.database).reply({ command, eventId: event.eventId, destinationId: event.channelId, actorId: event.userId });
    return { message: result.data, room: event.channelId, replayed: result.replayed, outboxId: result.outboxId };
  }
}
