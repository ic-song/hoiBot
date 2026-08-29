import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isHomeHeartExpressionCommandCandidate } from "./home-heart-expression-command.js";
import { HomeHeartExpressionService } from "./home-heart-expression-service.js";

// 펫홈 마음표현 명령을 원자 quota·반응 transaction에 연결합니다.
export class HomeHeartExpressionIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}
  public async execute(event: NormalizedIrisEvent): Promise<{ message: string; room: string; replayed: boolean; outboxId: string } | null> {
    if (!isHomeHeartExpressionCommandCandidate(event.message)) throw new ApplicationError("HOME_HEART_EXPRESSION_INVALID", "마음표현 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) return null;
    const result = await new HomeHeartExpressionService(this.database).execute({ eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId, message: event.message! });
    return result.status === "silent" || result.data === undefined || result.outboxId === undefined ? null : { message: result.data, room: event.channelId, replayed: result.replayed === true, outboxId: result.outboxId };
  }
}
