import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isSupportPremiumNoticeCommandCandidate } from "./support-premium-notice-command.js";
import { SupportPremiumNoticeService } from "./support-premium-notice-service.js";

// /알림 명령을 프리미엄 quota·inventory·broadcast transaction에 연결합니다.
export class SupportPremiumNoticeIrisHandler {
  public constructor(private readonly database: DatabaseClient, private readonly broadcastDestinationId = "broadcast:all") {}

  public async execute(event: NormalizedIrisEvent): Promise<{ message: string; room: string; replayed: boolean; outboxId: string } | null> {
    if (!isSupportPremiumNoticeCommandCandidate(event.message)) throw new ApplicationError("SUPPORT_PREMIUM_NOTICE_INVALID", "알림 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) return null;
    const result = await new SupportPremiumNoticeService(this.database).execute({ eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId, broadcastDestinationId: this.broadcastDestinationId, message: event.message! });
    if (result.status === "silent") return null;
    const reply = result.replies?.[0];
    if (reply === undefined) throw new ApplicationError("SUPPORT_PREMIUM_NOTICE_REPLY_REQUIRED", "알림 응답을 만들 수 없습니다.", 500);
    return { message: reply.data, room: reply.room, replayed: result.replayed === true, outboxId: reply.outboxId };
  }
}
