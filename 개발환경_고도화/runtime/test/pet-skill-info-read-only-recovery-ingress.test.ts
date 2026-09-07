import assert from "node:assert/strict";
import {it} from "node:test";
import type {DatabaseClient} from "../src/database.js";
import {executePetSkillInfoReadOnlyRecovery,resolvePetSkillInfoIngressCommand} from "../src/pet/pet-skill-info-read-only-recovery-ingress.js";
import {fingerprintPetSkillInfoBagStacks,fingerprintPetSkillInfoCatalog} from "../src/pet/pet-skill-info-shadow-service.js";
import {projectCanonicalPetSkillReadCatalog} from "../src/pet/canonical-pet-skill-read-provider.js";
import type {NormalizedIrisEvent} from "../src/integration/iris-normalizer.js";
import {createEnvironmentContext,verifyStartupDatabaseIdentity} from "../src/runtime/environment-context.js";

const event=(message:string):NormalizedIrisEvent=>({eventId:"event-admin-bag-1",providerEventId:"provider-1",providerCode:"iris",eventKind:"message",origin:"kakao",direction:"incoming",channelId:"room-1",userId:"admin-1",displayName:"호이 남",displayNameSource:"kakao_db",displayNameTrust:"trusted",message,eventCode:"MESSAGE",eventCategory:"command",monitoringGroup:"text",eventMetadata:{},payloadHash:"a".repeat(64)});
const exactCatalogRows=()=>Array.from({length:93},(_,index)=>({pet_skill_id:index===0?"skill001":`s${String(index).padStart(7,"0")}`,pet_skill_name:index===0?"하느님위에갓물주":`합성스킬${index}`,pet_skill_description:"효과",pet_skill_grade:index===0?"SS":"S",legacy_source_key:`skill_${String(index).padStart(3,"0")}`,display_order:index+1,base_draw_rate:index===0?"100":"0",fixed_draw_rate_flag:1,openable_flag:index===0?1:0,pet_skill_grade_emoji:"📙",required_tier_name:null,tier_exclusive_flag:0,equip_description:null,handler_key:"presentation_only",options_json:{},active_flag:1}));

it("matches the legacy lowercase index-zero dev parser exactly",()=>{
  assert.deepEqual(resolvePetSkillInfoIngressCommand("dev/  펫스킬정보"),{rawMessage:"dev/  펫스킬정보",effectiveMessage:"/펫스킬정보",devContext:"DEV_PREFIX"});
  assert.deepEqual(resolvePetSkillInfoIngressCommand("dev//펫스킬정보 청룡언월도"),{rawMessage:"dev//펫스킬정보 청룡언월도",effectiveMessage:"/펫스킬정보 청룡언월도",devContext:"DEV_PREFIX"});
  assert.equal(resolvePetSkillInfoIngressCommand("Dev/펫스킬정보"),undefined);
  assert.equal(resolvePetSkillInfoIngressCommand(" dev/펫스킬정보"),undefined);
  assert.equal(resolvePetSkillInfoIngressCommand("dev/"),undefined);
});

async function verified(databaseIdentity:string,environmentCode:"dev"|"prod"="dev"){
  const database={query:async<T>(sql:string)=>sql==="SELECT DATABASE() AS database_identity"?[{database_identity:databaseIdentity}] as T:[] as T} as DatabaseClient;
  return{database,environmentContext:await verifyStartupDatabaseIdentity(database,createEnvironmentContext({environmentCode,databaseIdentity}))};
}

it("consumes common READ_ONLY recovery and binds the complete synthetic admin projection into the no-reply receipt",async()=>{
  const kinds=["CASTLE_LORD","STAR","CARROT","THERMO","MINI_PET","TOP_LEVEL","MC","INTIMACY"];
  const catalogRows=exactCatalogRows(),catalog=projectCanonicalPetSkillReadCatalog(catalogRows,[],[]);
  const stacks=[{owned_pet_skill_id:"stack001",pet_skill_id:"skill001",legacy_source_key:"skill_000",pet_skill_name:"하느님위에갓물주",pet_skill_grade:"SS",display_order:1,quantity:3n}];
  const rows:unknown[]=[
    [{player_status:"active",identity_id:1n}],[{player_id:2n}],[{operator_id:4n,role_code:"manager"}],
    [{authority_decision:"ALLOW",source_fingerprint:"a".repeat(64),revision:1n}],
    [{player_id:2n,rank_emoji:"🐣",canonical_player_id:"player02"}],
    kinds.map((marker_kind,index)=>({marker_kind,marker_priority:index+1,assignment_status:index===0?"UNASSIGNED":"ASSIGNED",player_id:index===0?null:index===1?"player02":`player${index+20}`,legacy_player_id:index===0?null:BigInt(index+20),source_fingerprint:"b".repeat(64),revision:1n})),
    [],
    [{premium_active:0}],
    [{expected_source_key_count:1,projected_stack_count:1,quarantined_source_key_count:0,ignored_source_key_count:0,source_fingerprint:"c".repeat(64),catalog_projection_sha256:"d".repeat(64),catalog_set_fingerprint:fingerprintPetSkillInfoCatalog(catalog.definitions),stack_set_fingerprint:fingerprintPetSkillInfoBagStacks(stacks),revision:1n,run_status:"COMPLETE",import_sha256:"c".repeat(64),run_catalog_projection_sha256:"d".repeat(64),expected_source_count:93,projected_source_count:93,run_quarantined_source_count:0,run_ignored_source_count:0,expected_row_count:93,imported_row_count:93}],
    catalogRows,[],[],stacks
  ];
  const readParticipant={query:async<T>()=>rows.shift() as T};
  const processing:{duplicate:boolean;replies:never[]}={duplicate:false,replies:[]};
  let evaluations=0;
  const recovery={execute:async(input:Parameters<import("../src/dispatch/app-wiring-read-only-recovery-provider.js").MariaAppWiringReadOnlyRecoveryProvider["execute"]>[0])=>{
    assert.deepEqual(input.decision,{route:"SHADOW",effectMode:"READ_ONLY",reasonCode:"ROLLOUT_SHADOW",commandCode:"PET_SKILL_INFO",handlerKey:"pet_skill_info"});
    assert.equal(input.devContext,"DEFAULT");assert.equal(input.identityProviderCode,"kakao");
    const evaluated=await input.evaluateInSnapshot(readParticipant);evaluations+=1;
    input.validateReceiptProjection?.(evaluated.receiptProjection);
    const projection=evaluated.receiptProjection as {version:string;binding:{rawMessage:string;effectiveMessage:string;devContext:string;environmentCode:string;databaseIdentity:string};value:{reply:string}};
    assert.equal(projection.version,"PET_SKILL_INFO_PRIVATE_DEV_FORMAL_RECEIPT_V1");assert.match(projection.value.reply,/^\[💞대상\] 보유 스킬가방📙\[3\/100\]/);
    assert.deepEqual(projection.binding,{rawMessage:"/펫스킬정보 대상",effectiveMessage:"/펫스킬정보 대상",devContext:"DEFAULT",environmentCode:"dev",databaseIdentity:"pet_skill_info_ingress",eventId:"event-admin-bag-1",providerEventId:"provider-1",eventProviderCode:"iris",identityProviderCode:"kakao",externalUserId:"admin-1",displayName:"호이 남",displayNameSource:"kakao_db",displayNameTrust:"trusted",channelType:"open_group",externalChannelId:"room-1"});
    return{status:"completed",replayed:false,resultFingerprint:"c".repeat(64),value:evaluated.value,processing};
  }};
  const {database,environmentContext}=await verified("pet_skill_info_ingress");
  const normalized=event("/펫스킬정보 대상");
  const result=await executePetSkillInfoReadOnlyRecovery({database,recovery:recovery as never,environmentContext,event:normalized,replyIdentity:normalized,channelType:"open_group",reasonCode:"ROLLOUT_SHADOW"});
  assert.equal(result,processing);assert.equal(evaluations,1);assert.equal(rows.length,0);assert.deepEqual(result.replies,[]);
});

it("adds the exact DEV header and rejects DEV_PREFIX in a verified prod environment",async()=>{
  const run=async(environmentCode:"dev"|"prod")=>{
    const {database,environmentContext}=await verified(`pet_skill_info_${environmentCode}`,environmentCode),normalized=event("dev/  펫스킬정보");
    const snapshot={query:async<T>(sql:string)=>sql.includes("FROM external_identities identity")?[{player_status:"active",identity_id:1n}] as T:[] as T};
    const recovery={execute:async(input:any)=>{const evaluated=await input.evaluateInSnapshot(snapshot);input.validateReceiptProjection(evaluated.receiptProjection);return{processing:{duplicate:false,replies:[]},...evaluated};}};
    return executePetSkillInfoReadOnlyRecovery({database,recovery:recovery as never,environmentContext,event:normalized,replyIdentity:normalized,channelType:"open_group",reasonCode:"ROLLOUT_SHADOW"});
  };
  await run("dev");
  await assert.rejects(()=>run("prod"),/PET_SKILL_INFO_DEV_ENVIRONMENT_REQUIRED/);
});

it("requires an exact linked active private identity and a current canonical hoi/newbie/premium pass",async()=>{
  const run=async(passRows:unknown[])=>{
    const {database,environmentContext}=await verified("pet_skill_info_private"),normalized=event("/펫스킬정보");
    const rows:unknown[]=[[{identity_id:1n,player_id:2n,identity_status:"linked",player_status:"active"}],[{kst_today:"2026-09-07"}],passRows,[{player_status:"active",identity_id:1n}]];
    const snapshot={query:async<T>()=>rows.shift() as T};
    let projection:unknown;
    const recovery={execute:async(input:any)=>{const evaluated=await input.evaluateInSnapshot(snapshot);projection=evaluated.receiptProjection;input.validateReceiptProjection(projection);return{processing:{duplicate:false,replies:[]},...evaluated};}};
    await executePetSkillInfoReadOnlyRecovery({database,recovery:recovery as never,environmentContext,event:normalized,replyIdentity:normalized,channelType:"open_direct",reasonCode:"ROLLOUT_SHADOW"});
    return projection as {authorization:{mode:string;identityId:string;playerId:string;activePassCodes:string[]};value:{reply:string}};
  };
  const active=(pass_id:bigint,pass_code:string)=>({pass_id,pass_code,entitlement_kind:"permanent",end_date:null,pass_status:"active",definition_active:1});
  const dated=(pass_id:bigint,end_date:string)=>({pass_id,pass_code:"newbie",entitlement_kind:"dated",end_date,pass_status:"active",definition_active:1n});
  const accepted=await run([active(3n,"hoi"),active(4n,"premium")]);
  assert.deepEqual(accepted.authorization,{mode:"PRIVATE_PASS",identityId:"1",playerId:"2",activePassCodes:["hoi","premium"]});
  assert.match(accepted.value.reply,/^사용법:/);
  await assert.rejects(()=>run([]),/PET_SKILL_INFO_PRIVATE_PASS_REQUIRED/);
  assert.deepEqual((await run([dated(5n,"2026-09-07")])).authorization.activePassCodes,["newbie"]);
  await assert.rejects(()=>run([dated(6n,"2026-09-06")]),/PET_SKILL_INFO_PRIVATE_PASS_REQUIRED/);
  await assert.rejects(()=>run([{...active(7n,"premium"),pass_status:"revoked"}]),/PET_SKILL_INFO_PRIVATE_PASS_REQUIRED/);
  await assert.rejects(()=>run([active(3n,"hoi"),active(4n,"hoi")]),/PET_SKILL_INFO_PRIVATE_PASS_DUPLICATE/);
});
