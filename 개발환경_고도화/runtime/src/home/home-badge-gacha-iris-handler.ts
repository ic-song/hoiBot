import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isHomeBadgeGachaCommandCandidate } from "./home-badge-gacha-command.js";
import { HomeBadgeGachaService } from "./home-badge-gacha-service.js";

// 홈뱃지 오픈 1~3 명령을 카탈로그 기반 원자 transaction에 연결합니다.
export class HomeBadgeGachaIrisHandler {
  public constructor(private readonly database: DatabaseClient, private readonly broadcastIds: readonly string[] = []) {}

  public async execute(event: NormalizedIrisEvent): Promise<{ message: string; room: string; replayed: boolean; outboxId: string }> {
    if (!isHomeBadgeGachaCommandCandidate(event.message)) throw new ApplicationError("HOME_BADGE_GACHA_COMMAND_INVALID", "홈뱃지 오픈 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) throw new ApplicationError("HOME_BADGE_GACHA_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    const result = await new HomeBadgeGachaService(this.database, this.broadcastIds).execute({ eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId, message: event.message! });
    const reply = result.replies?.[0];
    if (reply === undefined) throw new ApplicationError("HOME_BADGE_GACHA_REPLY_REQUIRED", "홈뱃지 오픈 응답을 만들 수 없습니다.", 500);
    return { message: reply.data, room: reply.room, replayed: result.replayed === true, outboxId: reply.outboxId };
  }
}
