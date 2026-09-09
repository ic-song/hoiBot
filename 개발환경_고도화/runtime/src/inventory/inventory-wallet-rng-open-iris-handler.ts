import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isInventoryWalletRngOpenCommandCandidate } from "./inventory-wallet-rng-open-command.js";
import { InventoryWalletRngOpenService } from "./inventory-wallet-rng-open-service.js";

// 지갑털기 명령을 원자 inventory·currency·RNG transaction에 연결합니다.
export class InventoryWalletRngOpenIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(event: NormalizedIrisEvent): Promise<{ message: string; room: string; replayed: boolean; outboxId: string } | null> {
    if (!isInventoryWalletRngOpenCommandCandidate(event.message)) throw new ApplicationError("INVENTORY_WALLET_RNG_OPEN_INVALID", "지갑털기 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) return null;
    const result = await new InventoryWalletRngOpenService(this.database).execute({ eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId, message: event.message! });
    if (result.status === "silent") return null;
    const reply = result.replies?.[0];
    if (reply === undefined) throw new ApplicationError("INVENTORY_WALLET_RNG_OPEN_REPLY_REQUIRED", "지갑털기 응답을 만들 수 없습니다.", 500);
    return { message: reply.data, room: reply.room, replayed: result.replayed === true, outboxId: reply.outboxId };
  }
}
