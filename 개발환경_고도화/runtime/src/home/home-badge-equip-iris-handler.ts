import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isHomeBadgeEquipCommand } from "./home-badge-equip-command.js";
import { HomeBadgeEquipService } from "./home-badge-equip-service.js";

// 정규화된 Iris 이벤트를 대표 홈뱃지 장착·해제 transaction으로 전달합니다.
export class HomeBadgeEquipIrisHandler {
  private readonly service: HomeBadgeEquipService;

  constructor(database: DatabaseClient) {
    this.service = new HomeBadgeEquipService(database);
  }

  async execute(event: NormalizedIrisEvent): Promise<{ outboxId: string; room: string; message: string }> {
    if (!isHomeBadgeEquipCommand(event.message)) throw new ApplicationError("HOME_BADGE_EQUIP_COMMAND_INVALID", "홈뱃지 장착 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) throw new ApplicationError("HOME_BADGE_EQUIP_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    const result = await this.service.execute({
      eventId: event.eventId,
      externalUserId: event.userId,
      destinationId: event.channelId,
      message: event.message!
    });
    return { outboxId: result.outboxId, room: event.channelId, message: result.message };
  }
}
