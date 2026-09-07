import type { DatabaseClient } from "../database.js";
import type { MariaAppWiringReadOnlyRecoveryProvider } from "../dispatch/app-wiring-read-only-recovery-provider.js";
import type { ChannelNameObservation, EventProcessingResult } from "../integration/event-processing-service.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { PetSkillInfoShadowService } from "./pet-skill-info-shadow-service.js";

export async function executePetSkillInfoReadOnlyRecovery(input:{
  database:DatabaseClient;
  recovery:Pick<MariaAppWiringReadOnlyRecoveryProvider,"execute">;
  event:NormalizedIrisEvent;
  replyIdentity:NormalizedIrisEvent;
  channelType:"open_group"|"open_direct";
  reasonCode:string;
  channelName?:ChannelNameObservation;
}):Promise<EventProcessingResult>{
  if(input.replyIdentity.userId===undefined||input.replyIdentity.channelId===undefined||input.replyIdentity.message===undefined)throw new Error("PET_SKILL_INFO_RECOVERY_BINDING_REQUIRED");
  const recovered=await input.recovery.execute({
    event:input.event,replyIdentity:input.replyIdentity,channelType:input.channelType,identityProviderCode:"kakao",
    devContext:"DEFAULT",actor:"app:pet-skill-info",
    decision:{route:"SHADOW",effectMode:"READ_ONLY",reasonCode:input.reasonCode,commandCode:"PET_SKILL_INFO",handlerKey:"pet_skill_info"},
    ...(input.channelName===undefined?{}:{channelName:input.channelName}),
    evaluateInSnapshot:async transaction=>{
      const value=await new PetSkillInfoShadowService(input.database).evaluateInSnapshot(transaction,{externalUserId:input.replyIdentity.userId!,externalChannelId:input.replyIdentity.channelId,displayName:input.replyIdentity.displayName,message:input.replyIdentity.message!});
      return{value,receiptProjection:{version:"PET_SKILL_INFO_SHADOW_V1",value}};
    },
    errorCode:error=>error instanceof Error&&/^[A-Z][A-Z0-9_]{0,63}$/.test(error.message)?error.message:"PET_SKILL_INFO_SHADOW_FAILED"
  });
  return recovered.processing;
}
