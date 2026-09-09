import assert from "node:assert/strict";
import {it} from "node:test";
import type {DatabaseClient} from "../src/database.js";
import type {NormalizedIrisEvent} from "../src/integration/iris-normalizer.js";
import {executePetSkillInfoReadOnlyRecovery,parsePetSkillInfoPrivateDenialReceiptV2,parsePetSkillInfoPrivateDenialReceiptV3,type PetSkillInfoPrivateDenialReceiptV2} from "../src/pet/pet-skill-info-read-only-recovery-ingress.js";
import {createEnvironmentContext,verifyStartupDatabaseIdentity} from "../src/runtime/environment-context.js";

const databaseIdentity="pet_skill_private_notice";
const configurationFingerprint="c".repeat(64);
const channelName={displayName:"합성 개인톡방",sourceCode:"kakao_chat_room_meta" as const};
const actorContextProvider={resolve:async()=>({selectionSource:"ACTIVE_CONTEXT" as const,platformCode:"kakao" as const,externalContextId:"private-room-1",externalIdentityId:"11",selectedLegacyPlayerId:"22",selectedCanonicalPlayerId:"player22",entitlementLegacyPlayerId:"22",portalAccountId:"portal01",platformContextMembershipId:"member01",selectionVersion:"1"})};

function event(message:string,input:{displayName?:string|null;displayNameSource?:NormalizedIrisEvent["displayNameSource"];displayNameTrust?:NormalizedIrisEvent["displayNameTrust"]}={}):NormalizedIrisEvent{
  const displayName=input.displayName===undefined?"합성 사용자":input.displayName;
  return{eventId:"event-private-denial-v2",providerEventId:"provider-private-denial-v2",providerCode:"iris",eventKind:"message",origin:"kakao",direction:"incoming",channelId:"private-room-1",userId:"kakao-user-1",...(displayName===null?{}:{displayName}),displayNameSource:input.displayNameSource??"kakao_db",displayNameTrust:input.displayNameTrust??"trusted",message,eventCode:"MESSAGE",eventCategory:"command",monitoringGroup:"text",eventMetadata:{},payloadHash:"a".repeat(64)};
}

async function verified(){
  const database={query:async<T>(sql:string)=>sql==="SELECT DATABASE() AS database_identity"?[{database_identity:databaseIdentity}] as T:[] as T} as DatabaseClient;
  return{database,environmentContext:await verifyStartupDatabaseIdentity(database,createEnvironmentContext({environmentCode:"dev",databaseIdentity}))};
}

async function run(input:{message?:string;displayName?:string|null;displayNameSource?:NormalizedIrisEvent["displayNameSource"];displayNameTrust?:NormalizedIrisEvent["displayNameTrust"];room?:typeof channelName;identityRows?:unknown[];configRows?:unknown[]}){
  const message=input.message??"/펫스킬정보",normalized=event(message,{displayName:input.displayName===undefined?"합성 사용자":input.displayName,...(input.displayNameSource===undefined?{}:{displayNameSource:input.displayNameSource}),...(input.displayNameTrust===undefined?{}:{displayNameTrust:input.displayNameTrust})});
  const queries:Array<{sql:string;values:readonly unknown[]|undefined}>=[];
  const snapshot={query:async<T>(sql:string,values?:readonly unknown[])=>{
    queries.push({sql,values});
    if(sql.includes("FROM external_identities identity JOIN players"))return[{identity_id:11n,player_id:22n,identity_status:"linked",player_status:"active"}] as T;
    if(sql.startsWith("SELECT DATE_FORMAT"))return[{kst_today:"2026-09-07"}] as T;
    if(sql.includes("FROM player_support_passes"))return[] as T;
    if(sql.startsWith("SELECT id external_identity_id"))return(input.identityRows??[{external_identity_id:11n}]) as T;
    if(sql.startsWith("SELECT external_channel_id,delivery_enabled,configuration_fingerprint FROM private_chat_denial_notification_channels"))return(input.configRows??[{external_channel_id:"gm-channel-stable-1",delivery_enabled:1,configuration_fingerprint:configurationFingerprint}]) as T;
    throw new Error(`UNEXPECTED_QUERY:${sql}`);
  }};
  let projection:unknown;
  const recovery={execute:async(recoveryInput:any)=>{
    const evaluated=await recoveryInput.evaluateInSnapshot(snapshot);projection=evaluated.receiptProjection;
    recoveryInput.validateReceiptProjection(projection);
    return{status:"completed",replayed:false,terminalStatus:evaluated.terminalStatus,resultFingerprint:"d".repeat(64),receiptProjection:projection,value:evaluated.value,processing:{duplicate:false,replies:[]}};
  }};
  const {database,environmentContext}=await verified();
  const result=await executePetSkillInfoReadOnlyRecovery({database,recovery:recovery as never,environmentContext,event:normalized,replyIdentity:normalized,channelType:"open_direct",reasonCode:"ROLLOUT_SHADOW",actorContext:actorContextProvider,...(input.room===undefined?{}:{channelName:input.room})});
  return{projection:projection as Record<string,unknown>,result,queries};
}

it("creates an exact dual-context V3 denial receipt from one stable identity and one environment-bound notification config",async()=>{
  const message=`/펫스킬정보\r\n${"가".repeat(110)}`;
  const actual=await run({message,room:channelName});
  assert.equal(actual.result.denialReason,"PET_SKILL_INFO_PRIVATE_PASS_REQUIRED");
  assert.equal(actual.result.privateDenialNotificationRequired,true);
  const receipt=parsePetSkillInfoPrivateDenialReceiptV3(actual.projection);
  assert.deepEqual(receipt.notification,{
    scope:"PET_SKILL_INFO_ONLY",commandCode:"PET_SKILL_INFO",environmentCode:"dev",databaseIdentity,providerCode:"kakao",
    externalIdentityId:"11",externalUserId:"kakao-user-1",displayName:"합성 사용자",privateRoomName:"합성 개인톡방",privateRoomNameSource:"kakao_chat_room_meta",
    messagePreview:`${message.replace(/[\r\n]+/g," ").trim().slice(0,100)}...`,notifyEvery:3,previewMaxLength:100,destinationChannelId:"gm-channel-stable-1",deliveryEnabled:true,configurationFingerprint
  });
  const configQuery=actual.queries.find(query=>query.sql.startsWith("SELECT external_channel_id,delivery_enabled,configuration_fingerprint FROM private_chat_denial_notification_channels"));
  assert.deepEqual(configQuery?.values,["dev",databaseIdentity]);
  assert.match(configQuery?.sql??"",/provider_code='kakao'.*ORDER BY private_chat_denial_notification_channel_id LIMIT 2/);
  assert.doesNotMatch(configQuery?.sql??"",/delivery_enabled\s*=/);
});

it("uses the exact legacy preview normalization, empty marker, UTF-16 slice, and ellipsis rules",async()=>{
  const normalized=parsePetSkillInfoPrivateDenialReceiptV3((await run({message:"/펫스킬정보\n\r   대상",room:channelName})).projection);
  assert.equal(normalized.notification.messagePreview,"/펫스킬정보    대상");
  const emojiMessage=`/펫스킬정보 ${"😀".repeat(60)}`,emoji=parsePetSkillInfoPrivateDenialReceiptV3((await run({message:emojiMessage,room:channelName})).projection);
  assert.equal(emoji.notification.messagePreview,`${emojiMessage.slice(0,100)}...`);
});

it("keeps a non-notifiable dual-context receipt when trusted notification evidence is unavailable",async()=>{
  const noRoom=await run({});assert.equal(noRoom.projection.version,"PET_SKILL_INFO_DUAL_CONTEXT_DENIAL_RECEIPT_V1");assert.equal(noRoom.result.privateDenialNotificationRequired,undefined);
  const noName=await run({room:channelName,displayName:null});assert.equal(noName.projection.version,"PET_SKILL_INFO_DUAL_CONTEXT_DENIAL_RECEIPT_V1");assert.equal(noName.result.privateDenialNotificationRequired,undefined);
  const untrusted=await run({room:channelName,displayNameSource:"iris_cache",displayNameTrust:"untrusted"});assert.equal(untrusted.projection.version,"PET_SKILL_INFO_DUAL_CONTEXT_DENIAL_RECEIPT_V1");assert.equal(untrusted.result.privateDenialNotificationRequired,undefined);
  assert.equal((await run({room:channelName,identityRows:[]})).projection.version,"PET_SKILL_INFO_DUAL_CONTEXT_DENIAL_RECEIPT_V1");
  assert.equal((await run({room:channelName,identityRows:[{external_identity_id:11n},{external_identity_id:12n}]})).projection.version,"PET_SKILL_INFO_DUAL_CONTEXT_DENIAL_RECEIPT_V1");
  assert.equal((await run({room:channelName,configRows:[]})).projection.version,"PET_SKILL_INFO_DUAL_CONTEXT_DENIAL_RECEIPT_V1");
  assert.equal((await run({room:channelName,configRows:[{external_channel_id:"a",delivery_enabled:1,configuration_fingerprint:configurationFingerprint}, {external_channel_id:"b",delivery_enabled:1,configuration_fingerprint:configurationFingerprint}]})).projection.version,"PET_SKILL_INFO_DUAL_CONTEXT_DENIAL_RECEIPT_V1");
});

it("keeps disabled delivery as an exact V3 snapshot and accepts the persisted false boolean",async()=>{
  const actual=await run({room:channelName,configRows:[{external_channel_id:"gm-channel-stable-1",delivery_enabled:0,configuration_fingerprint:configurationFingerprint}]});
  assert.equal(actual.projection.version,"PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V3");
  assert.equal(actual.result.privateDenialNotificationRequired,true);
  assert.equal(parsePetSkillInfoPrivateDenialReceiptV3(actual.projection).notification.deliveryEnabled,false);
});

it("parses persisted V3 fail-closed and rejects coordinated binding, actor, policy, preview, room, identity, and config tampering",async()=>{
  const original=parsePetSkillInfoPrivateDenialReceiptV3((await run({room:channelName})).projection);
  const tamper=(change:(receipt:any)=>void)=>{const copy=structuredClone(original);change(copy);assert.throws(()=>parsePetSkillInfoPrivateDenialReceiptV3(copy),/PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V3_INVALID/);};
  tamper(receipt=>{receipt.binding.environmentCode="prod";});
  tamper(receipt=>{receipt.notification.externalIdentityId="0";});
  tamper(receipt=>{receipt.notification.externalUserId="other";});
  tamper(receipt=>{receipt.notification.displayName="other";});
  tamper(receipt=>{receipt.notification.privateRoomNameSource="memory";});
  tamper(receipt=>{receipt.notification.messagePreview="forged";});
  tamper(receipt=>{receipt.notification.notifyEvery=4;});
  tamper(receipt=>{receipt.notification.previewMaxLength=99;});
  tamper(receipt=>{receipt.notification.deliveryEnabled="false";});
  tamper(receipt=>{receipt.notification.configurationFingerprint="INVALID";});
  tamper(receipt=>{receipt.actorContext.selectionVersion="0";});
  tamper(receipt=>{receipt.actorContext.externalContextId="other-room";});
  tamper(receipt=>{receipt.actorContext.externalIdentityId="12";});
  tamper(receipt=>{receipt.extra=true;});
});

it("accepts an immutable historical V1 replay without evaluating or requiring the new config",async()=>{
  const normalized=event("/펫스킬정보"),{database,environmentContext}=await verified();
  const projection={version:"PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V1",binding:{rawMessage:"/펫스킬정보",effectiveMessage:"/펫스킬정보",devContext:"DEFAULT",environmentCode:"dev",databaseIdentity,eventId:normalized.eventId,providerEventId:normalized.providerEventId,eventProviderCode:"iris",identityProviderCode:"kakao",externalUserId:normalized.userId,displayName:normalized.displayName,displayNameSource:normalized.displayNameSource,displayNameTrust:normalized.displayNameTrust,channelType:"open_direct",externalChannelId:normalized.channelId},authorization:{mode:"PRIVATE_DENIED",reasonCode:"PET_SKILL_INFO_PRIVATE_PASS_REQUIRED"},value:{status:"denied",reasonCode:"PET_SKILL_INFO_PRIVATE_PASS_REQUIRED"}};
  let evaluations=0;
  const recovery={execute:async(input:any)=>{const original=input.evaluateInSnapshot;input.evaluateInSnapshot=async(...args:unknown[])=>{evaluations+=1;return original(...args);};input.validateReceiptProjection(projection);return{status:"completed",replayed:true,terminalStatus:"SHADOW_DENIED",resultFingerprint:"f".repeat(64),receiptProjection:projection,processing:{duplicate:true,replies:[]}};}};
  const result=await executePetSkillInfoReadOnlyRecovery({database,recovery:recovery as never,environmentContext,event:normalized,replyIdentity:normalized,channelType:"open_direct",reasonCode:"ROLLOUT_SHADOW",channelName});
  assert.equal(result.denialReason,"PET_SKILL_INFO_PRIVATE_PASS_REQUIRED");assert.equal(evaluations,0);
  assert.throws(()=>parsePetSkillInfoPrivateDenialReceiptV2(projection),/PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V2_INVALID/);
});
