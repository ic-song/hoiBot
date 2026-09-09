import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { isMiniPetBattleCommand, MiniPetBattleExecuteService } from "./mini-pet-battle-execute-service.js";

// exact 미니펫대전 이벤트를 원자 정산 서비스에 연결합니다.
export class MiniPetBattleExecuteIrisHandler{
  constructor(private readonly database:DatabaseClient){}
  async execute(event:NormalizedIrisEvent):Promise<Array<{message:string;room:string;replayed:boolean;outboxId:string}>>{
    if(!isMiniPetBattleCommand(event.message))throw new ApplicationError("MINI_PET_BATTLE_COMMAND_INVALID","정확한 /미니펫대전을 입력해 주세요.",422);
    if(!event.userId||!event.channelId)throw new ApplicationError("MINI_PET_BATTLE_IDENTITY_REQUIRED","사용자 식별 정보를 확인할 수 없습니다.",422);
    const result=await new MiniPetBattleExecuteService(this.database).handle({externalUserId:event.userId,channelId:event.channelId,message:event.message!,eventId:event.eventId,mode:"direct"});
    return result.messages.map((message,index)=>({message,room:event.channelId!,replayed:result.replayed,outboxId:result.outboxIds[index]!}));
  }
}
