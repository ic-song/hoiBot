import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { AutoDailyQuestOrchestrationService, isAutoDailyQuestCommand } from "./auto-daily-quest-orchestration-service.js";

// exact 자동일퀘 이벤트를 상위 batch transaction에 연결합니다.
export class AutoDailyQuestOrchestrationIrisHandler {
  constructor(private readonly database: DatabaseClient) {}
  async execute(event: NormalizedIrisEvent): Promise<Array<{message:string;room:string;replayed:boolean;outboxId:string}>> {
    if(!isAutoDailyQuestCommand(event.message))throw new ApplicationError("AUTO_DAILY_COMMAND_INVALID","정확한 /자동일퀘 또는 ㅇㅋㅋ를 입력해 주세요.",422);
    if(!event.userId||!event.channelId)throw new ApplicationError("AUTO_DAILY_IDENTITY_REQUIRED","사용자 식별 정보를 확인할 수 없습니다.",422);
    const result=await new AutoDailyQuestOrchestrationService(this.database).handle({externalUserId:event.userId,channelId:event.channelId,message:event.message!,eventId:event.eventId});
    return[{message:result.data,room:event.channelId,replayed:result.replayed,outboxId:result.outboxId}];
  }
}
