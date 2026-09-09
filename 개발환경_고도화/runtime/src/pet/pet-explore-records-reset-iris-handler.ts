import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isPetExploreRecordsResetCommand } from "./pet-explore-records-reset-command.js";
import { PetExploreRecordsResetService } from "./pet-explore-records-reset-service.js";

// exact 초기화 명령을 권한 검증·snapshot backup·원자 삭제 service에 연결합니다.
export class PetExploreRecordsResetIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(event: NormalizedIrisEvent): Promise<{ message: string; room: string; replayed: boolean; outboxId: string }> {
    if (!isPetExploreRecordsResetCommand(event.message)) throw new ApplicationError("PET_EXPLORE_RECORDS_RESET_COMMAND_INVALID", "펫탐험 전적 초기화 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) throw new ApplicationError("PET_EXPLORE_RECORDS_RESET_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    const result = await new PetExploreRecordsResetService(this.database).execute({ eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId, message: event.message! });
    return { message: result.data, room: event.channelId, replayed: result.replayed, outboxId: result.outboxId };
  }
}
