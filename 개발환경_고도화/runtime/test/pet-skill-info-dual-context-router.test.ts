import assert from "node:assert/strict";
import { it } from "node:test";
import type { DatabaseClient } from "../src/database.js";
import type { NormalizedIrisEvent } from "../src/integration/iris-normalizer.js";
import { executePetSkillInfoReadOnlyRecovery } from "../src/pet/pet-skill-info-read-only-recovery-ingress.js";
import type { PetSkillInfoActorContext } from "../src/pet/pet-skill-info-actor-context-provider.js";
import { createEnvironmentContext, verifyStartupDatabaseIdentity } from "../src/runtime/environment-context.js";

const actor=Object.freeze({selectionSource:"ACTIVE_CONTEXT" as const,platformCode:"kakao" as const,externalContextId:"room-a",externalIdentityId:"7",selectedLegacyPlayerId:"22",selectedCanonicalPlayerId:"player22",entitlementLegacyPlayerId:"11",portalAccountId:"portal01",platformContextMembershipId:"member01",selectionVersion:"4"});
const event:NormalizedIrisEvent={eventId:"dual-context-event-1",providerEventId:"provider-dual-1",providerCode:"iris",eventKind:"message",origin:"kakao",direction:"incoming",channelId:"room-a",userId:"room-user",displayName:"호이",displayNameSource:"kakao_db",displayNameTrust:"trusted",message:"/펫스킬정보",eventCode:"MESSAGE",eventCategory:"command",monitoringGroup:"text",eventMetadata:{},payloadHash:"a".repeat(64)};

async function environment(){
  const database={query:async<T>(sql:string)=>sql==="SELECT DATABASE() AS database_identity"?[{database_identity:"dual_context_dev"}] as T:[] as T} as DatabaseClient;
  return{database,environmentContext:await verifyStartupDatabaseIdentity(database,createEnvironmentContext({environmentCode:"dev",databaseIdentity:"dual_context_dev"}))};
}

it("방별 활성 게임계정과 대표계정 권위를 새 receipt에 고정한다",async()=>{
  const {database,environmentContext}=await environment();
  const queries:Array<{sql:string;values:readonly unknown[]|undefined}>=[];
  const snapshot={query:async<T>(sql:string,values?:readonly unknown[])=>{queries.push({sql,values});return(sql.includes("identity.status identity_status")?[{identity_id:7n,player_id:11n,identity_status:"linked",player_status:"active"}]:sql.startsWith("SELECT DATE_FORMAT")?[{kst_today:"2026-09-08"}]:sql.includes("FROM player_support_passes")?[{pass_id:1n,pass_code:"premium",entitlement_kind:"permanent",end_date:null,pass_status:"active",definition_active:1}]:[])as T;}};
  let projection:any;
  const recovery={execute:async(input:any)=>{const evaluated=await input.evaluateInSnapshot(snapshot);projection=evaluated.receiptProjection;input.validateReceiptProjection(projection);return{status:"completed",replayed:false,terminalStatus:"SHADOW_EVALUATED",resultFingerprint:"b".repeat(64),receiptProjection:projection,value:evaluated.value,processing:{duplicate:false,replies:[]}};}};
  const locations:unknown[]=[];
  await executePetSkillInfoReadOnlyRecovery({database,recovery:recovery as never,environmentContext,event,replyIdentity:event,channelType:"open_direct",reasonCode:"ROLLOUT_SHADOW",actorContext:{resolve:async(_transaction,input)=>{locations.push(input);return actor;}}});
  assert.deepEqual(locations,[{identityProviderCode:"kakao",externalUserId:"room-user",externalContextId:"room-a"}]);
  assert.equal(projection.version,"PET_SKILL_INFO_DUAL_CONTEXT_RECEIPT_V1");
  assert.deepEqual(projection.actorContext,actor);
  assert.deepEqual(projection.authorization,{mode:"PRIVATE_PASS",identityId:"7",playerId:"11",activePassCodes:["premium"]});
  assert.deepEqual(queries.find(row=>row.sql.includes("FROM player_support_passes"))?.values,["11"]);
  assert.equal(queries.some(row=>row.sql.startsWith("SELECT player.status player_status")),false,"shadow service must not re-resolve the actor");
});

it("주입 없는 실제 ingress 기본 경로가 Maria actor provider를 사용한다",async()=>{
  const {database,environmentContext}=await environment();
  const sqls:string[]=[];
  const snapshot={query:async<T>(sql:string)=>{
    sqls.push(sql);
    if(sql.includes("caller_identity.id AS external_identity_id"))return[{legacy_player_id:22n,canonical_player_id:"player22",external_identity_id:7n,display_name:"TT",rank_emoji:null,provider_code:"kakao",caller_link_id:"link0001"}]as T;
    if(sql.includes("representative_link.player_id AS representative_player_id"))return[{portal_account_id:"portal01",platform_context_membership_id:"member01",selection_version:4n,representative_player_id:11n}]as T;
    throw new Error(`UNEXPECTED_QUERY:${sql}`);
  }};
  let projection:any;
  const recovery={execute:async(input:any)=>{const evaluated=await input.evaluateInSnapshot(snapshot);projection=evaluated.receiptProjection;input.validateReceiptProjection(projection);return{status:"completed",replayed:false,terminalStatus:"SHADOW_EVALUATED",resultFingerprint:"e".repeat(64),receiptProjection:projection,value:evaluated.value,processing:{duplicate:false,replies:[]}};}};
  await executePetSkillInfoReadOnlyRecovery({database,recovery:recovery as never,environmentContext,event,replyIdentity:event,channelType:"open_group",reasonCode:"ROLLOUT_SHADOW"});
  assert.equal(projection.actorContext.selectedLegacyPlayerId,"22");
  assert.equal(projection.actorContext.entitlementLegacyPlayerId,"11");
  assert.equal(sqls.length,2);
});

it("동일 event replay는 계정변경 뒤에도 저장된 선택을 재조회하지 않는다",async()=>{
  const {database,environmentContext}=await environment();
  let stored:unknown,resolves=0,evaluations=0;
  const actorProvider={resolve:async()=>{resolves+=1;return resolves===1?actor:{...actor,selectedLegacyPlayerId:"33",selectedCanonicalPlayerId:"player33",selectionVersion:"5"} as PetSkillInfoActorContext;}};
  const snapshot={query:async<T>()=>[] as T};
  const recovery={execute:async(input:any)=>{if(stored!==undefined){input.validateReceiptProjection(stored);return{status:"completed",replayed:true,terminalStatus:"SHADOW_EVALUATED",resultFingerprint:"c".repeat(64),receiptProjection:stored,processing:{duplicate:true,replies:[]}};}evaluations+=1;const evaluated=await input.evaluateInSnapshot(snapshot);stored=evaluated.receiptProjection;input.validateReceiptProjection(stored);return{status:"completed",replayed:false,terminalStatus:"SHADOW_EVALUATED",resultFingerprint:"c".repeat(64),receiptProjection:stored,value:evaluated.value,processing:{duplicate:false,replies:[]}};}};
  await executePetSkillInfoReadOnlyRecovery({database,recovery:recovery as never,environmentContext,event,replyIdentity:event,channelType:"open_group",reasonCode:"ROLLOUT_SHADOW",actorContext:actorProvider});
  await executePetSkillInfoReadOnlyRecovery({database,recovery:recovery as never,environmentContext,event,replyIdentity:event,channelType:"open_group",reasonCode:"ROLLOUT_SHADOW",actorContext:actorProvider});
  assert.equal(resolves,1);assert.equal(evaluations,1);assert.equal((stored as any).actorContext.selectionVersion,"4");
});

it("receipt의 room·membership·selection 변조를 fail-close 한다",async()=>{
  const {database,environmentContext}=await environment();
  let validate:(projection:unknown)=>void=()=>{throw new Error("VALIDATOR_MISSING");},projection:any;
  const recovery={execute:async(input:any)=>{const evaluated=await input.evaluateInSnapshot({query:async<T>()=>[] as T});projection=evaluated.receiptProjection;validate=input.validateReceiptProjection;validate(projection);return{status:"completed",replayed:false,terminalStatus:"SHADOW_EVALUATED",resultFingerprint:"d".repeat(64),receiptProjection:projection,value:evaluated.value,processing:{duplicate:false,replies:[]}};}};
  await executePetSkillInfoReadOnlyRecovery({database,recovery:recovery as never,environmentContext,event,replyIdentity:event,channelType:"open_group",reasonCode:"ROLLOUT_SHADOW",actorContext:{resolve:async()=>actor}});
  for(const changed of[{...actor,externalContextId:"room-b"},{...actor,platformContextMembershipId:"bad"},{...actor,selectionVersion:"0"},{...actor,entitlementLegacyPlayerId:"0"}]){
    assert.throws(()=>validate({...projection,actorContext:changed}),/PET_SKILL_INFO_ACTOR_CONTEXT_RECEIPT_INVALID/);
  }
});
