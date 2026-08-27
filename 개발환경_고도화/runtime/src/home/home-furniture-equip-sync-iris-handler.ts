import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { isHomeFurnitureEquipSyncCommand } from "./home-furniture-equip-sync-command.js";
import { HomeFurnitureEquipSyncService } from "./home-furniture-equip-sync-service.js";

// exact 관리자 명령을 stable 가구 동기화 transaction에 연결합니다.
export class HomeFurnitureEquipSyncIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}
  public async execute(event: NormalizedIrisEvent): Promise<{message:string;replayed:boolean;outboxId:string}> {
    if (!isHomeFurnitureEquipSyncCommand(event.message)) throw new ApplicationError("HOME_FURNITURE_EQUIP_SYNC_COMMAND_INVALID","장착 가구 동기화 명령 형식을 확인해 주세요.",422);
    if (!event.userId || !event.channelId) throw new ApplicationError("HOME_FURNITURE_EQUIP_SYNC_IDENTITY_REQUIRED","사용자 식별 정보를 확인할 수 없습니다.",422);
    const result=await new HomeFurnitureEquipSyncService(this.database).execute({eventId:event.eventId,externalUserId:event.userId,destinationId:event.channelId});
    return {message:result.reply,replayed:result.replayed,outboxId:result.outboxId};
  }
}
