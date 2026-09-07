import type { DatabaseClient } from "../database.js";
import type { AppWiringReadParticipant } from "../dispatch/app-wiring-operation-provider.js";
import type { AppWiringDevContext, MariaAppWiringReadOnlyRecoveryProvider } from "../dispatch/app-wiring-read-only-recovery-provider.js";
import type { ChannelNameObservation, EventProcessingResult } from "../integration/event-processing-service.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { assertVerifiedEnvironmentContext, type VerifiedEnvironmentContext } from "../runtime/environment-context.js";
import { isPetSkillInfoShadowCandidate, PetSkillInfoShadowService } from "./pet-skill-info-shadow-service.js";
import { formatPetSkillCatalogReadinessReply, MariaCanonicalPetSkillReadinessProvider, type PetSkillCatalogReadiness } from "./canonical-pet-skill-readiness-provider.js";
import { MariaPetSkillInfoActorContextProvider, type PetSkillInfoActorContext } from "./pet-skill-info-actor-context-provider.js";

const RECEIPT_VERSION="PET_SKILL_INFO_PRIVATE_DEV_FORMAL_RECEIPT_V1" as const;
const READINESS_RECEIPT_VERSION="PET_SKILL_INFO_DEV_READINESS_RECEIPT_V1" as const;
const DENIAL_RECEIPT_VERSION="PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V1" as const;
const DENIAL_RECEIPT_V2_VERSION="PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V2" as const;
const DUAL_CONTEXT_RECEIPT_VERSION="PET_SKILL_INFO_DUAL_CONTEXT_RECEIPT_V1" as const;
const DUAL_CONTEXT_READINESS_RECEIPT_VERSION="PET_SKILL_INFO_DUAL_CONTEXT_READINESS_RECEIPT_V1" as const;
const DUAL_CONTEXT_DENIAL_RECEIPT_VERSION="PET_SKILL_INFO_DUAL_CONTEXT_DENIAL_RECEIPT_V1" as const;
const DENIAL_RECEIPT_V3_VERSION="PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V3" as const;
const PRIVATE_DENIAL_COMMAND_SCOPE="PET_SKILL_INFO_ONLY" as const;
const PRIVATE_DENIAL_COMMAND_CODE="PET_SKILL_INFO" as const;
const PRIVATE_DENIAL_NOTIFY_EVERY=3 as const;
const PRIVATE_DENIAL_PREVIEW_MAX_LENGTH=100 as const;
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
type PrivateCallerIdentity={readonly identityId:string;readonly legacyPlayerId:string};

export interface PetSkillInfoPrivateDenialReceiptV2{
  readonly version:typeof DENIAL_RECEIPT_V2_VERSION;
  readonly binding:{readonly rawMessage:string;readonly effectiveMessage:string;readonly devContext:AppWiringDevContext;readonly environmentCode:"dev"|"prod";readonly databaseIdentity:string;readonly eventId:string;readonly providerEventId:string|null;readonly eventProviderCode:string;readonly identityProviderCode:"kakao";readonly externalUserId:string;readonly displayName:string|null;readonly displayNameSource:string|null;readonly displayNameTrust:string|null;readonly channelType:"open_direct";readonly externalChannelId:string};
  readonly authorization:PrivateDenialEvidence;
  readonly value:{readonly status:"denied";readonly reasonCode:PetSkillInfoPrivateDenialReason};
  readonly notification:{
    readonly scope:typeof PRIVATE_DENIAL_COMMAND_SCOPE;readonly commandCode:typeof PRIVATE_DENIAL_COMMAND_CODE;
    readonly environmentCode:"dev"|"prod";readonly databaseIdentity:string;readonly providerCode:"kakao";
    readonly externalIdentityId:string;readonly externalUserId:string;readonly displayName:string;
    readonly privateRoomName:string;readonly privateRoomNameSource:ChannelNameObservation["sourceCode"];
    readonly messagePreview:string;readonly notifyEvery:typeof PRIVATE_DENIAL_NOTIFY_EVERY;readonly previewMaxLength:typeof PRIVATE_DENIAL_PREVIEW_MAX_LENGTH;
    readonly destinationChannelId:string;readonly deliveryEnabled:boolean;readonly configurationFingerprint:string;
  };
}

function record(value:unknown):Record<string,unknown>|undefined{return typeof value==="object"&&value!==null&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
function exactKeys(value:Record<string,unknown>,keys:readonly string[]):boolean{return Object.keys(value).length===keys.length&&keys.every(key=>Object.prototype.hasOwnProperty.call(value,key));}
function assertActorContextProjection(value:unknown,binding:Record<string,unknown>):asserts value is PetSkillInfoActorContext{
  const actor=record(value),positive=(candidate:unknown)=>typeof candidate==="string"&&/^[1-9][0-9]*$/.test(candidate),cuid=(candidate:unknown)=>typeof candidate==="string"&&/^[a-z][a-z0-9]{7}$/.test(candidate);
  if(actor===undefined||!exactKeys(actor,["selectionSource","platformCode","externalContextId","externalIdentityId","selectedLegacyPlayerId","selectedCanonicalPlayerId","entitlementLegacyPlayerId","portalAccountId","platformContextMembershipId","selectionVersion"])
    ||(actor.selectionSource!=="ACTIVE_CONTEXT"&&actor.selectionSource!=="LEGACY_CROSSWALK")||actor.platformCode!==binding.identityProviderCode||actor.externalContextId!==binding.externalChannelId
    ||!positive(actor.externalIdentityId)||!positive(actor.selectedLegacyPlayerId)||!cuid(actor.selectedCanonicalPlayerId)||!positive(actor.entitlementLegacyPlayerId))throw new Error("PET_SKILL_INFO_ACTOR_CONTEXT_RECEIPT_INVALID");
  if(actor.selectionSource==="ACTIVE_CONTEXT"){
    if(!cuid(actor.portalAccountId)||!cuid(actor.platformContextMembershipId)||!positive(actor.selectionVersion))throw new Error("PET_SKILL_INFO_ACTOR_CONTEXT_RECEIPT_INVALID");
  }else if(actor.portalAccountId!==null||actor.platformContextMembershipId!==null||actor.selectionVersion!==null||actor.entitlementLegacyPlayerId!==actor.selectedLegacyPlayerId)throw new Error("PET_SKILL_INFO_ACTOR_CONTEXT_RECEIPT_INVALID");
}

export interface PetSkillInfoPrivateDenialReceiptV3{
  readonly version:typeof DENIAL_RECEIPT_V3_VERSION;
  readonly binding:PetSkillInfoPrivateDenialReceiptV2["binding"];
  readonly authorization:PrivateDenialEvidence;
  readonly actorContext:PetSkillInfoActorContext;
  readonly value:PetSkillInfoPrivateDenialReceiptV2["value"];
  readonly notification:PetSkillInfoPrivateDenialReceiptV2["notification"];
}
function legacyPrivateDenialPreview(rawMessage:string):string{
  const normalized=String(rawMessage||"").replace(/[\r\n]+/g," ").trim();
  if(normalized.length===0)return"-";
  return normalized.length>PRIVATE_DENIAL_PREVIEW_MAX_LENGTH?`${normalized.slice(0,PRIVATE_DENIAL_PREVIEW_MAX_LENGTH)}...`:normalized;
}

// Persisted V2 receipt parser. Any shape, policy, or internal binding mismatch throws and must fail closed.
export function parsePetSkillInfoPrivateDenialReceiptV2(projection:unknown):PetSkillInfoPrivateDenialReceiptV2{
  const receipt=record(projection),binding=record(receipt?.binding),authorization=record(receipt?.authorization),value=record(receipt?.value),notification=record(receipt?.notification);
  const invalid=()=>{throw new Error("PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V2_INVALID");};
  if(receipt===undefined||receipt.version!==DENIAL_RECEIPT_V2_VERSION||!exactKeys(receipt,["version","binding","authorization","value","notification"])
    ||binding===undefined||!exactKeys(binding,["rawMessage","effectiveMessage","devContext","environmentCode","databaseIdentity","eventId","providerEventId","eventProviderCode","identityProviderCode","externalUserId","displayName","displayNameSource","displayNameTrust","channelType","externalChannelId"])
    ||typeof binding.rawMessage!=="string"||typeof binding.effectiveMessage!=="string"||(binding.devContext!=="DEFAULT"&&binding.devContext!=="DEV_PREFIX")||(binding.environmentCode!=="dev"&&binding.environmentCode!=="prod")
    ||typeof binding.databaseIdentity!=="string"||binding.databaseIdentity.length===0||typeof binding.eventId!=="string"||binding.eventId.length===0||(binding.providerEventId!==null&&typeof binding.providerEventId!=="string")
    ||typeof binding.eventProviderCode!=="string"||binding.identityProviderCode!=="kakao"||typeof binding.externalUserId!=="string"||binding.externalUserId.length===0
    ||(binding.displayName!==null&&typeof binding.displayName!=="string")||(binding.displayNameSource!==null&&typeof binding.displayNameSource!=="string")||(binding.displayNameTrust!==null&&typeof binding.displayNameTrust!=="string")
    ||binding.channelType!=="open_direct"||typeof binding.externalChannelId!=="string"||binding.externalChannelId.length===0
    ||authorization===undefined||!exactKeys(authorization,["mode","reasonCode"])||authorization.mode!=="PRIVATE_DENIED"||!isPrivateDenialReason(authorization.reasonCode)
    ||value===undefined||!exactKeys(value,["status","reasonCode"])||value.status!=="denied"||value.reasonCode!==authorization.reasonCode
    ||notification===undefined||!exactKeys(notification,["scope","commandCode","environmentCode","databaseIdentity","providerCode","externalIdentityId","externalUserId","displayName","privateRoomName","privateRoomNameSource","messagePreview","notifyEvery","previewMaxLength","destinationChannelId","deliveryEnabled","configurationFingerprint"])
    ||notification.scope!==PRIVATE_DENIAL_COMMAND_SCOPE||notification.commandCode!==PRIVATE_DENIAL_COMMAND_CODE||notification.environmentCode!==binding.environmentCode||notification.databaseIdentity!==binding.databaseIdentity||notification.providerCode!=="kakao"||binding.displayNameSource!=="kakao_db"||binding.displayNameTrust!=="trusted"||typeof binding.displayName!=="string"
    ||typeof notification.externalIdentityId!=="string"||!/^[1-9][0-9]*$/.test(notification.externalIdentityId)||notification.externalUserId!==binding.externalUserId||typeof notification.displayName!=="string"||notification.displayName!==binding.displayName
    ||typeof notification.privateRoomName!=="string"||notification.privateRoomName.trim().length===0||(notification.privateRoomNameSource!=="kakao_open_link"&&notification.privateRoomNameSource!=="kakao_chat_room_meta")
    ||typeof notification.messagePreview!=="string"||notification.messagePreview!==legacyPrivateDenialPreview(binding.rawMessage)||notification.notifyEvery!==PRIVATE_DENIAL_NOTIFY_EVERY||notification.previewMaxLength!==PRIVATE_DENIAL_PREVIEW_MAX_LENGTH
    ||typeof notification.destinationChannelId!=="string"||notification.destinationChannelId.length===0||typeof notification.deliveryEnabled!=="boolean"||typeof notification.configurationFingerprint!=="string"||!/^[0-9a-f]{64}$/.test(notification.configurationFingerprint))invalid();
  return projection as PetSkillInfoPrivateDenialReceiptV2;
}

async function resolvePrivateDenialNoticeSnapshot(transaction:AppWiringReadParticipant,input:{externalUserId:string;displayName:string;rawMessage:string;environment:VerifiedEnvironmentContext;channelName?:ChannelNameObservation}):Promise<PetSkillInfoPrivateDenialReceiptV2["notification"]|undefined>{
  const channelName=input.channelName;
  if(channelName===undefined||channelName.displayName.trim().length===0||(channelName.sourceCode!=="kakao_open_link"&&channelName.sourceCode!=="kakao_chat_room_meta"))return undefined;
  const identities=await transaction.query<Array<{external_identity_id:bigint}>>("SELECT id external_identity_id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? ORDER BY id LIMIT 2",[input.externalUserId]);
  if(identities.length!==1)return undefined;
  const externalIdentityId=String(identities[0]!.external_identity_id);
  if(!/^[1-9][0-9]*$/.test(externalIdentityId))return undefined;
  const configs=await transaction.query<Array<{external_channel_id:string;delivery_enabled:number|boolean;configuration_fingerprint:string}>>("SELECT external_channel_id,delivery_enabled,configuration_fingerprint FROM private_chat_denial_notification_channels WHERE environment_code=? AND database_identity=? AND provider_code='kakao' ORDER BY private_chat_denial_notification_channel_id LIMIT 2",[input.environment.environmentCode,input.environment.databaseIdentity]);
  const config=configs.length===1?configs[0]:undefined;
  if(config===undefined||typeof config.external_channel_id!=="string"||config.external_channel_id.length===0||typeof config.configuration_fingerprint!=="string"||!/^[0-9a-f]{64}$/.test(config.configuration_fingerprint))return undefined;
  return{scope:PRIVATE_DENIAL_COMMAND_SCOPE,commandCode:PRIVATE_DENIAL_COMMAND_CODE,environmentCode:input.environment.environmentCode,databaseIdentity:input.environment.databaseIdentity,providerCode:"kakao",externalIdentityId,externalUserId:input.externalUserId,displayName:input.displayName,privateRoomName:channelName.displayName,privateRoomNameSource:channelName.sourceCode,messagePreview:legacyPrivateDenialPreview(input.rawMessage),notifyEvery:PRIVATE_DENIAL_NOTIFY_EVERY,previewMaxLength:PRIVATE_DENIAL_PREVIEW_MAX_LENGTH,destinationChannelId:config.external_channel_id,deliveryEnabled:Boolean(config.delivery_enabled),configurationFingerprint:config.configuration_fingerprint};
}

async function resolvePrivateCallerIdentity(transaction:AppWiringReadParticipant,externalUserId:string):Promise<PrivateCallerIdentity|PrivateDenialEvidence>{
  const actors=await transaction.query<Array<{identity_id:bigint;player_id:bigint;identity_status:string;player_status:string}>>(
    "SELECT identity.id identity_id,player.id player_id,identity.status identity_status,player.status player_status FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.deleted_at IS NULL WHERE identity.provider_code='kakao' AND identity.external_user_id=? ORDER BY identity.id LIMIT 2",[externalUserId]);
  if(actors.length>1)throw new Error("PET_SKILL_INFO_PRIVATE_IDENTITY_DUPLICATE");
  const actor=actors[0];
  if(actor===undefined||actor.identity_status!=="linked"||actor.player_status!=="active")return{mode:"PRIVATE_DENIED",reasonCode:"PET_SKILL_INFO_PRIVATE_IDENTITY_REQUIRED"};
  return{identityId:String(actor.identity_id),legacyPlayerId:String(actor.player_id)};
}

export function parsePetSkillInfoPrivateDenialReceiptV3(projection:unknown):PetSkillInfoPrivateDenialReceiptV3{
  const receipt=record(projection),binding=record(receipt?.binding);
  if(receipt===undefined||binding===undefined||receipt.version!==DENIAL_RECEIPT_V3_VERSION||!exactKeys(receipt,["version","binding","authorization","actorContext","value","notification"]))throw new Error("PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V3_INVALID");
  try{
    parsePetSkillInfoPrivateDenialReceiptV2({version:DENIAL_RECEIPT_V2_VERSION,binding:receipt.binding,authorization:receipt.authorization,value:receipt.value,notification:receipt.notification});
    assertActorContextProjection(receipt.actorContext,binding);
  }catch{throw new Error("PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V3_INVALID");}
  const authorization=record(receipt.authorization),actorContext=record(receipt.actorContext),notification=record(receipt.notification);
  if(authorization?.reasonCode!=="PET_SKILL_INFO_PRIVATE_PASS_REQUIRED"||actorContext?.externalIdentityId!==notification?.externalIdentityId)throw new Error("PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V3_INVALID");
  return projection as PetSkillInfoPrivateDenialReceiptV3;
}

async function resolvePrivatePassAccess(transaction:AppWiringReadParticipant,actor:PetSkillInfoActorContext):Promise<PrivateAccessEvidence|PrivateDenialEvidence>{
  const clock=(await transaction.query<Array<{kst_today:string}>>(
    "SELECT DATE_FORMAT(UTC_TIMESTAMP(3)+INTERVAL 9 HOUR,'%Y-%m-%d') kst_today"))[0];
  if(clock===undefined||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(clock.kst_today))throw new Error("PET_SKILL_INFO_PRIVATE_CLOCK_INVALID");
  const candidates=await transaction.query<Array<{pass_id:bigint;pass_code:string;entitlement_kind:string;end_date:string|null;pass_status:string;definition_active:number}>>(
    `SELECT pass.id pass_id,pass.pass_code,pass.entitlement_kind,DATE_FORMAT(pass.end_date,'%Y-%m-%d') end_date,pass.status pass_status,definition_row.active definition_active FROM player_support_passes pass JOIN support_pass_definitions definition_row ON definition_row.pass_code=pass.pass_code WHERE pass.player_id=? AND pass.pass_code IN ('hoi','newbie','premium') ORDER BY pass.pass_code,pass.id LIMIT 4`,[actor.entitlementLegacyPlayerId]);
  const passes=candidates.filter(row=>Number(row.definition_active)===1&&row.pass_status==="active"&&(row.entitlement_kind==="permanent"||(row.end_date!==null&&row.end_date>=clock.kst_today)));
  if(new Set(passes.map(row=>row.pass_code)).size!==passes.length)throw new Error("PET_SKILL_INFO_PRIVATE_PASS_DUPLICATE");
  if(passes.length===0)return{mode:"PRIVATE_DENIED",reasonCode:"PET_SKILL_INFO_PRIVATE_PASS_REQUIRED"};
  if(passes.some(row=>!["hoi","newbie","premium"].includes(row.pass_code)))throw new Error("PET_SKILL_INFO_PRIVATE_PASS_INVALID");
  return{mode:"PRIVATE_PASS",identityId:actor.externalIdentityId,playerId:actor.entitlementLegacyPlayerId,activePassCodes:Object.freeze(passes.map(row=>row.pass_code))};
}

function withDevHeader<T>(value:T,devContext:AppWiringDevContext):T{
  if(devContext!=="DEV_PREFIX"||typeof value!=="object"||value===null||Array.isArray(value))return value;
  const record=value as Record<string,unknown>;
  return(record.status==="shadow"&&typeof record.reply==="string"?{...record,reply:`${DEV_HEADER}${record.reply}`}:value)as T;
}

function assertFormalReceiptProjection(projection:unknown,input:{command:PetSkillInfoIngressCommand;environment:VerifiedEnvironmentContext;event:NormalizedIrisEvent;replyIdentity:NormalizedIrisEvent;channelType:"open_group"|"open_direct";channelName?:ChannelNameObservation}):void{
  if(typeof projection!=="object"||projection===null||Array.isArray(projection))throw new Error("PET_SKILL_INFO_RECEIPT_PROJECTION_INVALID");
  const receipt=projection as Record<string,unknown>,binding=receipt.binding;
  if((receipt.version!==RECEIPT_VERSION&&receipt.version!==READINESS_RECEIPT_VERSION&&receipt.version!==DENIAL_RECEIPT_VERSION&&receipt.version!==DENIAL_RECEIPT_V2_VERSION&&receipt.version!==DENIAL_RECEIPT_V3_VERSION&&receipt.version!==DUAL_CONTEXT_RECEIPT_VERSION&&receipt.version!==DUAL_CONTEXT_READINESS_RECEIPT_VERSION&&receipt.version!==DUAL_CONTEXT_DENIAL_RECEIPT_VERSION)||typeof binding!=="object"||binding===null||Array.isArray(binding)||!("value" in receipt)||typeof receipt.authorization!=="object"||receipt.authorization===null)throw new Error("PET_SKILL_INFO_RECEIPT_PROJECTION_INVALID");
  const actual=binding as Record<string,unknown>;
  const expected:Record<string,unknown>={rawMessage:input.command.rawMessage,effectiveMessage:input.command.effectiveMessage,devContext:input.command.devContext,
    environmentCode:input.environment.environmentCode,databaseIdentity:input.environment.databaseIdentity,eventId:input.event.eventId,
    providerEventId:input.event.providerEventId??null,eventProviderCode:input.event.providerCode,identityProviderCode:"kakao",
    externalUserId:input.replyIdentity.userId??null,displayName:input.replyIdentity.displayName??null,displayNameSource:input.replyIdentity.displayNameSource??null,
    displayNameTrust:input.replyIdentity.displayNameTrust??null,channelType:input.channelType,externalChannelId:input.replyIdentity.channelId??null};
  if(Object.keys(actual).length!==Object.keys(expected).length||Object.entries(expected).some(([key,value])=>actual[key]!==value))throw new Error("PET_SKILL_INFO_RECEIPT_BINDING_DRIFT");
  const dualContext=receipt.version===DUAL_CONTEXT_RECEIPT_VERSION||receipt.version===DUAL_CONTEXT_READINESS_RECEIPT_VERSION||receipt.version===DUAL_CONTEXT_DENIAL_RECEIPT_VERSION||receipt.version===DENIAL_RECEIPT_V3_VERSION;
  if(dualContext){
    const expectedKeys=receipt.version===DUAL_CONTEXT_READINESS_RECEIPT_VERSION?["version","binding","authorization","actorContext","readiness","value"]:receipt.version===DENIAL_RECEIPT_V3_VERSION?["version","binding","authorization","actorContext","value","notification"]:["version","binding","authorization","actorContext","value"];
    if(!exactKeys(receipt,expectedKeys))throw new Error("PET_SKILL_INFO_RECEIPT_PROJECTION_INVALID");
    assertActorContextProjection(receipt.actorContext,actual);
  }
  const authorization=receipt.authorization as Record<string,unknown>;
  if(receipt.version===READINESS_RECEIPT_VERSION||receipt.version===DUAL_CONTEXT_READINESS_RECEIPT_VERSION){
    const readiness=record(receipt.readiness),counts=record(readiness?.counts),value=record(receipt.value);
    const countValues=counts===undefined?[]:[counts.definitions,counts.imports,counts.aliases,counts.policies],allZero=countValues.length===4&&countValues.every(item=>item===0),allExpected=counts!==undefined&&counts.definitions===93&&counts.imports===93&&counts.aliases===30&&counts.policies===4;
    const expectedReason=allZero?"EMPTY":allExpected?"SEMANTIC_DRIFT":"COUNT_MISMATCH";
    if((receipt.version===READINESS_RECEIPT_VERSION&&!exactKeys(receipt,["version","binding","authorization","readiness","value"]))||input.command.devContext!=="DEV_PREFIX"||input.environment.environmentCode!=="dev"||readiness===undefined||!exactKeys(readiness,["status","reasonCode","counts"])||(readiness.status!=="UNREADY"&&readiness.status!=="PARTIAL")||counts===undefined||!exactKeys(counts,["definitions","imports","aliases","policies"])||countValues.some(item=>typeof item!=="number"||!Number.isSafeInteger(item)||item<0)||readiness.status!==(allZero?"UNREADY":"PARTIAL")||readiness.reasonCode!==expectedReason||value===undefined||!exactKeys(value,["status","reply"])||value.status!=="shadow"||value.reply!==formatPetSkillCatalogReadinessReply(readiness as Exclude<PetSkillCatalogReadiness,{status:"READY"}>))throw new Error("PET_SKILL_INFO_DEV_READINESS_RECEIPT_INVALID");
  }
  if(receipt.version===DENIAL_RECEIPT_V2_VERSION){
    const parsed=parsePetSkillInfoPrivateDenialReceiptV2(projection),channelName=input.channelName;
    if(channelName===undefined||parsed.notification.privateRoomName!==channelName.displayName||parsed.notification.privateRoomNameSource!==channelName.sourceCode)throw new Error("PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V2_ROOM_DRIFT");
    return;
  }
  if(receipt.version===DENIAL_RECEIPT_V3_VERSION){
    const parsed=parsePetSkillInfoPrivateDenialReceiptV3(projection),channelName=input.channelName;
    if(channelName===undefined||parsed.notification.privateRoomName!==channelName.displayName||parsed.notification.privateRoomNameSource!==channelName.sourceCode)throw new Error("PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V3_ROOM_DRIFT");
    return;
  }
  if(receipt.version===DENIAL_RECEIPT_VERSION||receipt.version===DUAL_CONTEXT_DENIAL_RECEIPT_VERSION){
    const value=receipt.value;
    if(input.channelType!=="open_direct"||Object.keys(authorization).length!==2||authorization.mode!=="PRIVATE_DENIED"||!isPrivateDenialReason(authorization.reasonCode)
      ||typeof value!=="object"||value===null||Array.isArray(value)||Object.keys(value).length!==2||(value as Record<string,unknown>).status!=="denied"||(value as Record<string,unknown>).reasonCode!==authorization.reasonCode)throw new Error("PET_SKILL_INFO_RECEIPT_AUTHORIZATION_INVALID");
    if(receipt.version===DUAL_CONTEXT_DENIAL_RECEIPT_VERSION&&authorization.reasonCode!=="PET_SKILL_INFO_PRIVATE_PASS_REQUIRED")throw new Error("PET_SKILL_INFO_RECEIPT_AUTHORIZATION_INVALID");
    return;
  }
  if(input.channelType==="open_group"){
    if(Object.keys(authorization).length!==1||authorization.mode!=="OPEN_GROUP")throw new Error("PET_SKILL_INFO_RECEIPT_AUTHORIZATION_INVALID");
  }else{
    const codes=authorization.activePassCodes;
    if(Object.keys(authorization).length!==4||authorization.mode!=="PRIVATE_PASS"||typeof authorization.identityId!=="string"||typeof authorization.playerId!=="string"||!Array.isArray(codes)||codes.length===0
      ||codes.some(code=>typeof code!=="string"||!["hoi","newbie","premium"].includes(code))||new Set(codes).size!==codes.length||codes.join("\u0000")!==[...codes].sort().join("\u0000"))throw new Error("PET_SKILL_INFO_RECEIPT_AUTHORIZATION_INVALID");
  }
  if(dualContext&&input.channelType==="open_direct"){
    const actor=receipt.actorContext as PetSkillInfoActorContext;
    if(authorization.identityId!==actor.externalIdentityId||authorization.playerId!==actor.entitlementLegacyPlayerId)throw new Error("PET_SKILL_INFO_RECEIPT_AUTHORIZATION_INVALID");
  }
  if(receipt.version===RECEIPT_VERSION&&input.command.devContext==="DEV_PREFIX"){
    const value=record(receipt.value),reply=value?.reply;
    if(value?.status==="shadow"&&typeof reply==="string"&&(reply.startsWith("[DEV 테스트환경]\n❌ DEV 펫스킬 카탈로그가 준비되지 않았습니다.")||reply.startsWith("[DEV 테스트환경]\n⚠️ DEV 펫스킬 카탈로그가 일부만 준비되었습니다.")))throw new Error("PET_SKILL_INFO_DEV_READINESS_RECEIPT_DOWNGRADE");
  }
}

function isPrivateDenialReason(value:unknown):value is PetSkillInfoPrivateDenialReason{
  return value==="PET_SKILL_INFO_PRIVATE_IDENTITY_REQUIRED"||value==="PET_SKILL_INFO_PRIVATE_PASS_REQUIRED";
}

export interface PetSkillInfoReadOnlyRecoveryResult{
  readonly processing:EventProcessingResult;
  readonly denialReason?:PetSkillInfoPrivateDenialReason;
  readonly privateDenialNotificationRequired?:true;
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
  readiness?:Pick<MariaCanonicalPetSkillReadinessProvider,"inspect">;
  actorContext?:Pick<MariaPetSkillInfoActorContextProvider,"resolve">;
}):Promise<PetSkillInfoReadOnlyRecoveryResult>{
  assertVerifiedEnvironmentContext(input.environmentContext);
  if(input.replyIdentity.userId===undefined||input.replyIdentity.channelId===undefined||input.event.message===undefined||input.replyIdentity.message!==input.event.message)throw new Error("PET_SKILL_INFO_RECOVERY_BINDING_REQUIRED");
  const command=resolvePetSkillInfoIngressCommand(input.event.message);
  if(command===undefined)throw new Error("PET_SKILL_INFO_COMMAND_NOT_MATCHED");
  const expected={command,environment:input.environmentContext,event:input.event,replyIdentity:input.replyIdentity,channelType:input.channelType,...(input.channelName===undefined?{}:{channelName:input.channelName})};
  const binding={rawMessage:command.rawMessage,effectiveMessage:command.effectiveMessage,devContext:command.devContext,
    environmentCode:input.environmentContext.environmentCode,databaseIdentity:input.environmentContext.databaseIdentity,eventId:input.event.eventId,
    providerEventId:input.event.providerEventId??null,eventProviderCode:input.event.providerCode,identityProviderCode:"kakao" as const,externalUserId:input.replyIdentity.userId,
    displayName:input.replyIdentity.displayName??null,displayNameSource:input.replyIdentity.displayNameSource??null,displayNameTrust:input.replyIdentity.displayNameTrust??null,
    channelType:input.channelType,externalChannelId:input.replyIdentity.channelId};
  const recovered=await input.recovery.execute<unknown>({
    event:input.event,replyIdentity:input.replyIdentity,channelType:input.channelType,identityProviderCode:"kakao",
    devContext:command.devContext,actor:"app:pet-skill-info",commandBinding:{rawMessage:command.rawMessage,effectiveMessage:command.effectiveMessage},
    decision:{route:"SHADOW",effectMode:"READ_ONLY",reasonCode:input.reasonCode,commandCode:"PET_SKILL_INFO",handlerKey:"pet_skill_info"},
    ...(input.channelName===undefined?{}:{channelName:input.channelName}),
    validateReceiptProjection:projection=>assertFormalReceiptProjection(projection,expected),
    evaluateInSnapshot:async transaction=>{
      if(command.devContext==="DEV_PREFIX"&&input.environmentContext.environmentCode!=="dev")throw new Error("PET_SKILL_INFO_DEV_ENVIRONMENT_REQUIRED");
      const denied=async(authorization:PrivateDenialEvidence,actorContext?:PetSkillInfoActorContext)=>{
        const value={status:"denied" as const,reasonCode:authorization.reasonCode};
        const notification=typeof input.replyIdentity.displayName==="string"&&input.replyIdentity.displayNameTrust==="trusted"&&input.replyIdentity.displayNameSource==="kakao_db"?await resolvePrivateDenialNoticeSnapshot(transaction,{externalUserId:input.replyIdentity.userId!,displayName:input.replyIdentity.displayName,rawMessage:command.rawMessage,environment:input.environmentContext,...(input.channelName===undefined?{}:{channelName:input.channelName})}):undefined;
        const receiptProjection=actorContext===undefined
          ?notification===undefined?{version:DENIAL_RECEIPT_VERSION,binding,authorization,value}:{version:DENIAL_RECEIPT_V2_VERSION,binding,authorization,value,notification}
          :notification===undefined?{version:DUAL_CONTEXT_DENIAL_RECEIPT_VERSION,binding,authorization,actorContext,value}:{version:DENIAL_RECEIPT_V3_VERSION,binding,authorization,actorContext,value,notification};
        return{terminalStatus:"SHADOW_DENIED" as const,value,receiptProjection};
      };
      const caller=input.channelType==="open_direct"?await resolvePrivateCallerIdentity(transaction,input.replyIdentity.userId!):undefined;
      if(caller!==undefined&&"mode" in caller)return denied(caller);
      const actorContext=await(input.actorContext??new MariaPetSkillInfoActorContextProvider()).resolve(transaction,{identityProviderCode:"kakao",externalUserId:input.replyIdentity.userId!,externalContextId:input.replyIdentity.channelId!});
      if(caller!==undefined&&caller.identityId!==actorContext.externalIdentityId)throw new Error("PET_SKILL_INFO_PRIVATE_IDENTITY_CONTEXT_DRIFT");
      const authorization:AccessEvidence=input.channelType==="open_direct"?await resolvePrivatePassAccess(transaction,actorContext):{mode:"OPEN_GROUP"};
      if(authorization.mode==="PRIVATE_DENIED"){
        return denied(authorization,actorContext);
      }
      const readiness=command.devContext==="DEV_PREFIX"?await(input.readiness??new MariaCanonicalPetSkillReadinessProvider()).inspect(transaction,input.environmentContext):undefined;
      const evaluated=readiness!==undefined&&readiness.status!=="READY"?{status:"shadow" as const,reply:formatPetSkillCatalogReadinessReply(readiness)}:await new PetSkillInfoShadowService(input.database).evaluateInSnapshot(transaction,{externalUserId:input.replyIdentity.userId!,externalChannelId:input.replyIdentity.channelId,displayName:input.replyIdentity.displayName,message:command.effectiveMessage,actorContext});
      const value=readiness!==undefined&&readiness.status!=="READY"?evaluated:withDevHeader(evaluated,command.devContext);
      return{value,receiptProjection:readiness!==undefined&&readiness.status!=="READY"?{version:DUAL_CONTEXT_READINESS_RECEIPT_VERSION,binding,authorization,actorContext,readiness,value}:{version:DUAL_CONTEXT_RECEIPT_VERSION,binding,authorization,actorContext,value}};
    },
    errorCode:error=>error instanceof Error&&/^[A-Z][A-Z0-9_]{0,63}$/.test(error.message)?error.message:"PET_SKILL_INFO_SHADOW_FAILED"
  });
  const projection=recovered.receiptProjection as {version?:unknown;authorization?:{mode?:unknown;reasonCode?:unknown}};
  const projectedReason=projection.authorization?.reasonCode;
  const denialProjection=(projection.version===DENIAL_RECEIPT_VERSION||projection.version===DENIAL_RECEIPT_V2_VERSION||projection.version===DUAL_CONTEXT_DENIAL_RECEIPT_VERSION||projection.version===DENIAL_RECEIPT_V3_VERSION)&&projection.authorization?.mode==="PRIVATE_DENIED"&&isPrivateDenialReason(projectedReason);
  if((recovered.terminalStatus==="SHADOW_DENIED")!==denialProjection)throw new Error("PET_SKILL_INFO_RECEIPT_TERMINAL_STATUS_DRIFT");
  const denialReason=denialProjection?projectedReason as PetSkillInfoPrivateDenialReason:undefined;
  return{processing:recovered.processing,...(denialReason===undefined?{}:{denialReason}),...((projection.version===DENIAL_RECEIPT_V2_VERSION||projection.version===DENIAL_RECEIPT_V3_VERSION)?{privateDenialNotificationRequired:true as const}:{})};
}
