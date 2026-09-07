import type { DatabaseClient } from "../database.js";
import type { AppWiringReadParticipant } from "../dispatch/app-wiring-operation-provider.js";
import type { AppWiringDevContext, MariaAppWiringReadOnlyRecoveryProvider } from "../dispatch/app-wiring-read-only-recovery-provider.js";
import type { ChannelNameObservation, EventProcessingResult } from "../integration/event-processing-service.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { assertVerifiedEnvironmentContext, type VerifiedEnvironmentContext } from "../runtime/environment-context.js";
import { isPetSkillInfoShadowCandidate, PetSkillInfoShadowService } from "./pet-skill-info-shadow-service.js";

const RECEIPT_VERSION="PET_SKILL_INFO_PRIVATE_DEV_FORMAL_RECEIPT_V1" as const;
const DENIAL_RECEIPT_VERSION="PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V1" as const;
const DEV_HEADER="[DEV 테스트환경]\n";

export interface PetSkillInfoIngressCommand{
  readonly rawMessage:string;
  readonly effectiveMessage:string;
  readonly devContext:AppWiringDevContext;
}

// 레거시와 동일하게 소문자 dev/가 index 0에 있을 때만 제거하고 slash를 보정합니다.
export function resolvePetSkillInfoIngressCommand(rawMessage:string|undefined):PetSkillInfoIngressCommand|undefined{
  if(rawMessage===undefined)return undefined;
  const isDev=rawMessage.indexOf("dev/")===0;
  const stripped=isDev?String(rawMessage).substring("dev/".length).trim():rawMessage;
  const effectiveMessage=isDev&&stripped!==""&&stripped.charAt(0)!=="/"?`/${stripped}`:stripped;
  if(!isPetSkillInfoShadowCandidate(effectiveMessage))return undefined;
  return{rawMessage,effectiveMessage,devContext:isDev?"DEV_PREFIX":"DEFAULT"};
}

type PrivateAccessEvidence={readonly mode:"PRIVATE_PASS";readonly identityId:string;readonly playerId:string;readonly activePassCodes:readonly string[]};
export type PetSkillInfoPrivateDenialReason="PET_SKILL_INFO_PRIVATE_IDENTITY_REQUIRED"|"PET_SKILL_INFO_PRIVATE_PASS_REQUIRED";
type PrivateDenialEvidence={readonly mode:"PRIVATE_DENIED";readonly reasonCode:PetSkillInfoPrivateDenialReason};
type AccessEvidence=PrivateAccessEvidence|PrivateDenialEvidence|{readonly mode:"OPEN_GROUP"};

async function resolvePrivatePassAccess(transaction:AppWiringReadParticipant,externalUserId:string):Promise<PrivateAccessEvidence|PrivateDenialEvidence>{
  const actors=await transaction.query<Array<{identity_id:bigint;player_id:bigint;identity_status:string;player_status:string}>>(
    "SELECT identity.id identity_id,player.id player_id,identity.status identity_status,player.status player_status FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.deleted_at IS NULL WHERE identity.provider_code='kakao' AND identity.external_user_id=? ORDER BY identity.id LIMIT 2",[externalUserId]);
  if(actors.length>1)throw new Error("PET_SKILL_INFO_PRIVATE_IDENTITY_DUPLICATE");
  const actor=actors[0];
  if(actor===undefined||actor.identity_status!=="linked"||actor.player_status!=="active")return{mode:"PRIVATE_DENIED",reasonCode:"PET_SKILL_INFO_PRIVATE_IDENTITY_REQUIRED"};
  const clock=(await transaction.query<Array<{kst_today:string}>>(
    "SELECT DATE_FORMAT(UTC_TIMESTAMP(3)+INTERVAL 9 HOUR,'%Y-%m-%d') kst_today"))[0];
  if(clock===undefined||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(clock.kst_today))throw new Error("PET_SKILL_INFO_PRIVATE_CLOCK_INVALID");
  const candidates=await transaction.query<Array<{pass_id:bigint;pass_code:string;entitlement_kind:string;end_date:string|null;pass_status:string;definition_active:number}>>(
    `SELECT pass.id pass_id,pass.pass_code,pass.entitlement_kind,DATE_FORMAT(pass.end_date,'%Y-%m-%d') end_date,pass.status pass_status,definition_row.active definition_active FROM player_support_passes pass JOIN support_pass_definitions definition_row ON definition_row.pass_code=pass.pass_code WHERE pass.player_id=? AND pass.pass_code IN ('hoi','newbie','premium') ORDER BY pass.pass_code,pass.id LIMIT 4`,[actor.player_id]);
  const passes=candidates.filter(row=>Number(row.definition_active)===1&&row.pass_status==="active"&&(row.entitlement_kind==="permanent"||(row.end_date!==null&&row.end_date>=clock.kst_today)));
  if(new Set(passes.map(row=>row.pass_code)).size!==passes.length)throw new Error("PET_SKILL_INFO_PRIVATE_PASS_DUPLICATE");
  if(passes.length===0)return{mode:"PRIVATE_DENIED",reasonCode:"PET_SKILL_INFO_PRIVATE_PASS_REQUIRED"};
  if(passes.some(row=>!["hoi","newbie","premium"].includes(row.pass_code)))throw new Error("PET_SKILL_INFO_PRIVATE_PASS_INVALID");
  return{mode:"PRIVATE_PASS",identityId:String(actor.identity_id),playerId:String(actor.player_id),activePassCodes:Object.freeze(passes.map(row=>row.pass_code))};
}

function withDevHeader<T>(value:T,devContext:AppWiringDevContext):T{
  if(devContext!=="DEV_PREFIX"||typeof value!=="object"||value===null||Array.isArray(value))return value;
  const record=value as Record<string,unknown>;
  return(record.status==="shadow"&&typeof record.reply==="string"?{...record,reply:`${DEV_HEADER}${record.reply}`}:value)as T;
}

function assertFormalReceiptProjection(projection:unknown,input:{command:PetSkillInfoIngressCommand;environment:VerifiedEnvironmentContext;event:NormalizedIrisEvent;replyIdentity:NormalizedIrisEvent;channelType:"open_group"|"open_direct"}):void{
  if(typeof projection!=="object"||projection===null||Array.isArray(projection))throw new Error("PET_SKILL_INFO_RECEIPT_PROJECTION_INVALID");
  const receipt=projection as Record<string,unknown>,binding=receipt.binding;
  if((receipt.version!==RECEIPT_VERSION&&receipt.version!==DENIAL_RECEIPT_VERSION)||typeof binding!=="object"||binding===null||Array.isArray(binding)||!("value" in receipt)||typeof receipt.authorization!=="object"||receipt.authorization===null)throw new Error("PET_SKILL_INFO_RECEIPT_PROJECTION_INVALID");
  const actual=binding as Record<string,unknown>;
  const expected:Record<string,unknown>={rawMessage:input.command.rawMessage,effectiveMessage:input.command.effectiveMessage,devContext:input.command.devContext,
    environmentCode:input.environment.environmentCode,databaseIdentity:input.environment.databaseIdentity,eventId:input.event.eventId,
    providerEventId:input.event.providerEventId??null,eventProviderCode:input.event.providerCode,identityProviderCode:"kakao",
    externalUserId:input.replyIdentity.userId??null,displayName:input.replyIdentity.displayName??null,displayNameSource:input.replyIdentity.displayNameSource??null,
    displayNameTrust:input.replyIdentity.displayNameTrust??null,channelType:input.channelType,externalChannelId:input.replyIdentity.channelId??null};
  if(Object.keys(actual).length!==Object.keys(expected).length||Object.entries(expected).some(([key,value])=>actual[key]!==value))throw new Error("PET_SKILL_INFO_RECEIPT_BINDING_DRIFT");
  const authorization=receipt.authorization as Record<string,unknown>;
  if(receipt.version===DENIAL_RECEIPT_VERSION){
    const value=receipt.value;
    if(input.channelType!=="open_direct"||Object.keys(authorization).length!==2||authorization.mode!=="PRIVATE_DENIED"||!isPrivateDenialReason(authorization.reasonCode)
      ||typeof value!=="object"||value===null||Array.isArray(value)||Object.keys(value).length!==2||(value as Record<string,unknown>).status!=="denied"||(value as Record<string,unknown>).reasonCode!==authorization.reasonCode)throw new Error("PET_SKILL_INFO_RECEIPT_AUTHORIZATION_INVALID");
    return;
  }
  if(input.channelType==="open_group"){
    if(Object.keys(authorization).length!==1||authorization.mode!=="OPEN_GROUP")throw new Error("PET_SKILL_INFO_RECEIPT_AUTHORIZATION_INVALID");
  }else{
    const codes=authorization.activePassCodes;
    if(Object.keys(authorization).length!==4||authorization.mode!=="PRIVATE_PASS"||typeof authorization.identityId!=="string"||typeof authorization.playerId!=="string"||!Array.isArray(codes)||codes.length===0
      ||codes.some(code=>typeof code!=="string"||!["hoi","newbie","premium"].includes(code))||new Set(codes).size!==codes.length||codes.join("\u0000")!==[...codes].sort().join("\u0000"))throw new Error("PET_SKILL_INFO_RECEIPT_AUTHORIZATION_INVALID");
  }
}

function isPrivateDenialReason(value:unknown):value is PetSkillInfoPrivateDenialReason{
  return value==="PET_SKILL_INFO_PRIVATE_IDENTITY_REQUIRED"||value==="PET_SKILL_INFO_PRIVATE_PASS_REQUIRED";
}

export interface PetSkillInfoReadOnlyRecoveryResult{
  readonly processing:EventProcessingResult;
  readonly denialReason?:PetSkillInfoPrivateDenialReason;
}

export async function executePetSkillInfoReadOnlyRecovery(input:{
  database:DatabaseClient;
  recovery:Pick<MariaAppWiringReadOnlyRecoveryProvider,"execute">;
  environmentContext:VerifiedEnvironmentContext;
  event:NormalizedIrisEvent;
  replyIdentity:NormalizedIrisEvent;
  channelType:"open_group"|"open_direct";
  reasonCode:string;
  channelName?:ChannelNameObservation;
}):Promise<PetSkillInfoReadOnlyRecoveryResult>{
  assertVerifiedEnvironmentContext(input.environmentContext);
  if(input.replyIdentity.userId===undefined||input.replyIdentity.channelId===undefined||input.event.message===undefined||input.replyIdentity.message!==input.event.message)throw new Error("PET_SKILL_INFO_RECOVERY_BINDING_REQUIRED");
  const command=resolvePetSkillInfoIngressCommand(input.event.message);
  if(command===undefined)throw new Error("PET_SKILL_INFO_COMMAND_NOT_MATCHED");
  const expected={command,environment:input.environmentContext,event:input.event,replyIdentity:input.replyIdentity,channelType:input.channelType};
  const recovered=await input.recovery.execute<unknown>({
    event:input.event,replyIdentity:input.replyIdentity,channelType:input.channelType,identityProviderCode:"kakao",
    devContext:command.devContext,actor:"app:pet-skill-info",commandBinding:{rawMessage:command.rawMessage,effectiveMessage:command.effectiveMessage},
    decision:{route:"SHADOW",effectMode:"READ_ONLY",reasonCode:input.reasonCode,commandCode:"PET_SKILL_INFO",handlerKey:"pet_skill_info"},
    ...(input.channelName===undefined?{}:{channelName:input.channelName}),
    validateReceiptProjection:projection=>assertFormalReceiptProjection(projection,expected),
    evaluateInSnapshot:async transaction=>{
      if(command.devContext==="DEV_PREFIX"&&input.environmentContext.environmentCode!=="dev")throw new Error("PET_SKILL_INFO_DEV_ENVIRONMENT_REQUIRED");
      const authorization:AccessEvidence=input.channelType==="open_direct"?await resolvePrivatePassAccess(transaction,input.replyIdentity.userId!):{mode:"OPEN_GROUP"};
      if(authorization.mode==="PRIVATE_DENIED"){
        const value={status:"denied" as const,reasonCode:authorization.reasonCode};
        return{terminalStatus:"SHADOW_DENIED" as const,value,receiptProjection:{version:DENIAL_RECEIPT_VERSION,binding:{rawMessage:command.rawMessage,effectiveMessage:command.effectiveMessage,devContext:command.devContext,
          environmentCode:input.environmentContext.environmentCode,databaseIdentity:input.environmentContext.databaseIdentity,eventId:input.event.eventId,
          providerEventId:input.event.providerEventId??null,eventProviderCode:input.event.providerCode,identityProviderCode:"kakao",externalUserId:input.replyIdentity.userId,
          displayName:input.replyIdentity.displayName??null,displayNameSource:input.replyIdentity.displayNameSource??null,displayNameTrust:input.replyIdentity.displayNameTrust??null,
          channelType:input.channelType,externalChannelId:input.replyIdentity.channelId},authorization,value}};
      }
      const evaluated=await new PetSkillInfoShadowService(input.database).evaluateInSnapshot(transaction,{externalUserId:input.replyIdentity.userId!,externalChannelId:input.replyIdentity.channelId,displayName:input.replyIdentity.displayName,message:command.effectiveMessage});
      const value=withDevHeader(evaluated,command.devContext);
      return{value,receiptProjection:{version:RECEIPT_VERSION,binding:{rawMessage:command.rawMessage,effectiveMessage:command.effectiveMessage,devContext:command.devContext,
        environmentCode:input.environmentContext.environmentCode,databaseIdentity:input.environmentContext.databaseIdentity,eventId:input.event.eventId,
        providerEventId:input.event.providerEventId??null,eventProviderCode:input.event.providerCode,identityProviderCode:"kakao",externalUserId:input.replyIdentity.userId,
        displayName:input.replyIdentity.displayName??null,displayNameSource:input.replyIdentity.displayNameSource??null,displayNameTrust:input.replyIdentity.displayNameTrust??null,
        channelType:input.channelType,externalChannelId:input.replyIdentity.channelId},authorization,value}};
    },
    errorCode:error=>error instanceof Error&&/^[A-Z][A-Z0-9_]{0,63}$/.test(error.message)?error.message:"PET_SKILL_INFO_SHADOW_FAILED"
  });
  const projection=recovered.receiptProjection as {version?:unknown;authorization?:{mode?:unknown;reasonCode?:unknown}};
  const projectedReason=projection.authorization?.reasonCode;
  const denialProjection=projection.version===DENIAL_RECEIPT_VERSION&&projection.authorization?.mode==="PRIVATE_DENIED"&&isPrivateDenialReason(projectedReason);
  if((recovered.terminalStatus==="SHADOW_DENIED")!==denialProjection)throw new Error("PET_SKILL_INFO_RECEIPT_TERMINAL_STATUS_DRIFT");
  const denialReason=denialProjection?projectedReason as PetSkillInfoPrivateDenialReason:undefined;
  return{processing:recovered.processing,...(denialReason===undefined?{}:{denialReason})};
}
