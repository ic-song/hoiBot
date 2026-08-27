import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { isHomeBaseballPitchCommandCandidate } from "./home-baseball-pitch-command.js";
import { HomeBaseballPitchService } from "./home-baseball-pitch-service.js";

// 투수 명령을 원자 야구공 소비·보상 transaction에 연결합니다.
export class HomeBaseballPitchIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}
  public async execute(event: NormalizedIrisEvent): Promise<Array<{message:string;replayed:boolean;outboxId:string}>> {
    if (!isHomeBaseballPitchCommandCandidate(event.message)) throw new ApplicationError("HOME_BASEBALL_PITCH_COMMAND_INVALID","투수 명령 형식을 확인해 주세요.",422);
    if (!event.userId || !event.channelId) throw new ApplicationError("HOME_BASEBALL_PITCH_IDENTITY_REQUIRED","사용자 식별 정보를 확인할 수 없습니다.",422);
    const result=await new HomeBaseballPitchService(this.database).execute({eventId:event.eventId,externalUserId:event.userId,destinationId:event.channelId,message:event.message!});
    return result.replies.map(reply=>({message:reply.message,replayed:result.replayed,outboxId:reply.outboxId}));
  }
}
