import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isInventoryFortunePouchCommandCandidate } from "./inventory-fortune-pouch-command.js";
import { InventoryFortunePouchService } from "./inventory-fortune-pouch-service.js";

// 복주머니 명령을 원자 inventory·RNG transaction에 연결합니다.
export class InventoryFortunePouchIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(event: NormalizedIrisEvent): Promise<{ message: string; room: string; replayed: boolean; outboxId: string } | null> {
    if (!isInventoryFortunePouchCommandCandidate(event.message)) throw new ApplicationError("INVENTORY_FORTUNE_POUCH_INVALID", "복주머니 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) return null;
    const result = await new InventoryFortunePouchService(this.database).execute({ eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId, message: event.message! });
    if (result.status === "silent") return null;
    const reply = result.replies?.[0];
    if (reply === undefined) throw new ApplicationError("INVENTORY_FORTUNE_POUCH_REPLY_REQUIRED", "복주머니 응답을 만들 수 없습니다.", 500);
    return { message: reply.data, room: reply.room, replayed: result.replayed === true, outboxId: reply.outboxId };
  }
}
