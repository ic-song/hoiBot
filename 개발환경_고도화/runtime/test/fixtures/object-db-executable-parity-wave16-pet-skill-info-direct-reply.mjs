import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { projectCanonicalPetSkillSeed } from "../../src/pet/canonical-pet-skill-read-seed.js";
import { resolvePetSkillInfoIngressCommand } from "../../src/pet/pet-skill-info-read-only-recovery-ingress.js";
import { createEnvironmentContext, verifyStartupDatabaseIdentity } from "../../src/runtime/environment-context.js";

const MODULE_EXECUTION_ID=randomUUID();
const digest=value=>createHash("sha256").update(value,"utf8").digest("hex");
const normalize=sql=>String(sql).replace(/\s+/g," ").trim();
const assert=(value,message)=>{if(!value)throw new Error(message);};
const DML=/^(?:INSERT|UPDATE|DELETE|REPLACE|MERGE|TRUNCATE)\b/i;
const baseline=JSON.parse(readFileSync(new URL("../../../migration-control/fixtures/synthetic-relational/pet-skill-definitions-v2400.json",import.meta.url),"utf8"));
const additions=JSON.parse(readFileSync(new URL("../../../migration-control/fixtures/synthetic-relational/pet-skill-post-freeze-v2435.json",import.meta.url),"utf8"));
const active93=()=>{const rows=[...baseline];for(const addition of[...additions.rows].sort((a,b)=>a.runtimeSourceIndex-b.runtimeSourceIndex))rows.splice(addition.runtimeSourceIndex,0,addition);return rows;};
const readyProjection=projectCanonicalPetSkillSeed(active93(),{S:10.5,A:18.1,B:20,C:47.7},additions.sourceHash);
const readyIds=new Map(readyProjection.definitions.map((row,index)=>[row.sourceKey,`s${String(index).padStart(7,"0")}`]));
const readyDefinitions=readyProjection.definitions.map(row=>({pet_skill_id:readyIds.get(row.sourceKey),pet_skill_name:row.source.name,pet_skill_description:row.source.effect,pet_skill_grade:row.source.grade,legacy_source_key:row.sourceKey,display_order:row.displayOrder,base_draw_rate:String(row.source.rate??0),fixed_draw_rate_flag:row.source.fixedRate===true?1:0,openable_flag:row.source.openable!==false?1:0,pet_skill_grade_emoji:"📙",required_tier_name:row.source.requiredTier??null,tier_exclusive_flag:row.source.tierExclusive===true?1:0,equip_description:row.source.equipComment??null,handler_key:row.handlerKey,options_json:row.options,raid_charm_bonus:String(Number(row.source.raidExp??0)),castle_charm_bonus:String(Number(row.source.castleExp??0)),active_flag:1,source_identifier:row.sourceKey,payload_fingerprint:digest(JSON.stringify([row.source.name,row.source.effect,row.source.grade,row.handlerKey,row.options,true]))}));
const readyAliases=readyProjection.aliases.map((row,index)=>({pet_skill_alias_id:`a${String(index).padStart(7,"0")}`,pet_skill_id:readyIds.get(row.sourceKey),source_identifier:row.sourceKey,alias_type:"legacy_name",alias_value:row.aliasValue,normalized_alias_value:row.normalizedAliasValue,active_flag:1}));
const readyPolicies=readyProjection.gradePolicies.map((row,index)=>({pet_skill_draw_grade_policy_id:`p${String(index).padStart(7,"0")}`,pet_skill_grade:row.grade,grade_probability_total:String(row.probabilityTotal),display_order:row.displayOrder,active_flag:1}));

function makeDatabase(binding,initialState){
  const state=initialState??{receipts:{},nextOutboxId:700};
  const calls=[];
  const query=async(sql,values=[])=>{
    const normalizedSql=normalize(sql);calls.push({channel:"query",normalizedSql,values,rowCount:0});
    if(normalizedSql==="SELECT DATABASE() AS database_identity")return[{database_identity:"wave16_direct"}];
    if(normalizedSql.includes("SELECT DATABASE() database_identity"))return[{database_identity:"wave16_direct",definitions:93n,imports:93n,aliases:30n,policies:4n}];
    if(normalizedSql.includes("FROM command_aliases a"))return[{command_code:"PET_SKILL_INFO",handler_key:"pet_skill_info",auth_scope:"VERIFIED_USER",rollout_state:"CANARY"}];
    if(normalizedSql.startsWith("SELECT id FROM external_identities"))return binding.input.passCode===null?[]:[{id:12n}];
    if(normalizedSql.startsWith("SELECT id FROM channels"))return[{id:11n}];
    if(normalizedSql.includes("identity.status identity_status")&&normalizedSql.includes("FROM external_identities identity"))return binding.input.passCode===null?[]:[{identity_id:12n,player_id:21n,identity_status:"linked",player_status:"active"}];
    if(normalizedSql.startsWith("SELECT DATE_FORMAT(UTC_TIMESTAMP"))return[{kst_today:"2026-09-08"}];
    if(normalizedSql.includes("FROM player_support_passes pass"))return binding.input.passCode===null?[]:[{pass_id:31n,pass_code:"hoi",entitlement_kind:"permanent",end_date:null,pass_status:"active",definition_active:1}];
    if(normalizedSql.includes("FROM external_identities identity")&&normalizedSql.includes("player_status"))return[{player_status:"active",identity_id:12n}];
    if(normalizedSql.includes("FROM player_profiles profile"))return[];
    if(normalizedSql.includes("SELECT definition.pet_skill_id"))return readyDefinitions;
    if(normalizedSql.includes("SELECT import_row.source_identifier,alias_row.alias_type"))return readyAliases;
    if(normalizedSql.startsWith("SELECT pet_skill_grade"))return readyPolicies;
    if(normalizedSql.includes("FROM canonical_pet_skill_aliases"))return readyAliases;
    if(normalizedSql.includes("FROM canonical_pet_skill_draw_grade_policies"))return readyPolicies;
    if(normalizedSql.includes("CAST(raid_charm_bonus"))return readyDefinitions.map(row=>({pet_skill_id:row.pet_skill_id,raid_charm_bonus:row.raid_charm_bonus,castle_charm_bonus:row.castle_charm_bonus}));
    if(normalizedSql.includes("FROM canonical_pet_skill_definitions"))return readyDefinitions;
    throw new Error(`Wave16 unexpected SELECT: ${normalizedSql}`);
  };
  const execute=async(sql,values=[])=>{const normalizedSql=normalize(sql);calls.push({channel:"execute",normalizedSql,values,rowCount:1});return{affectedRows:1n,insertId:0n};};
  const transaction={query,execute,withSavepoint:async work=>work(transaction)};
  const run=async work=>work(transaction);
  return{database:{query,execute,withTransaction:run,withRootTransaction:run,withConsistentRootTransaction:run,withControlledTransaction:run,withReadOnlySnapshot:async work=>work({query}),ping:async()=>{},verifyRollback:async()=>true,close:async()=>{}},state,calls,transaction};
}

function makeRecovery(databaseState,transaction,calls,counters){
  const record=sql=>calls.push({channel:"execute",normalizedSql:sql,values:[],rowCount:1});
  return{execute:async input=>{
    const existing=databaseState.receipts[input.event.eventId];
    if(existing!==undefined)return{...existing,replayed:true,processing:{duplicate:true,replies:[]}};
    counters.evaluatorRuns+=1;
    let evaluation;try{evaluation=await input.evaluateInSnapshot(transaction);}catch(error){counters.error=error instanceof Error?error.message:String(error);throw error;}
    input.validateReceiptProjection?.(evaluation.receiptProjection);
    for(const sql of[
      "INSERT INTO event_inbox (event_id) VALUES (?)",
      "INSERT INTO command_routing_decisions (event_id,message_hash,command_code,route,reason_code) VALUES (?,?,?,?,?)",
      "INSERT INTO canonical_app_wiring_operations (app_wiring_operation_id) VALUES (?)",
      "INSERT INTO operations (idempotency_scope) VALUES ('app-wiring.read-only')",
      "INSERT INTO command_executions (event_id,command_code) VALUES (?,?)"
    ])record(sql);
    let reply;
    if(evaluation.terminalStatus==="MODERN_REPLIED"&&evaluation.reply!==undefined){
      const outboxId=String(++databaseState.nextOutboxId);record("INSERT INTO outbox_messages (operation_id,provider_code,destination_id,message_type,payload_json,status) VALUES (?,'iris',?,'text',?,'pending')");
      reply={outboxId,room:evaluation.reply.destinationId,data:evaluation.reply.data};
    }
    record("UPDATE event_inbox SET processing_status='processed' WHERE event_id=?");
    const completed={status:"completed",replayed:false,resultFingerprint:digest(JSON.stringify(evaluation.receiptProjection)),terminalStatus:evaluation.terminalStatus??"SHADOW_EVALUATED",receiptProjection:evaluation.receiptProjection,value:evaluation.value,...(reply===undefined?{}:{reply})};
    databaseState.receipts[input.event.eventId]=completed;
    return{...completed,processing:{duplicate:false,replies:[]}};
  }};
}

export async function executeWave16PetSkillInfoDirectReply(args){
  const binding=args.binding,input=binding.input,expected=binding.expected;
  const resolved=resolvePetSkillInfoIngressCommand(input.rawMessage);
  if(resolved===undefined)return{executedConsumerId:binding.consumerId,executedCaseId:binding.harnessCaseId,moduleExecutionId:MODULE_EXECUTION_ID,assertionCount:1,reply:"NO_REPLY",result:JSON.stringify({accepted:false,reason:"PET_SKILL_INFO_COMMAND_NOT_MATCHED",evaluatorRuns:0,outboxCount:0,externalReplyCount:0}),databaseEvidence:{state:args.initialState??{receipts:{},nextOutboxId:700},calls:[],evaluatorRuns:0,outboxCount:0,externalReplyCount:0,sourceDomainDmlCount:0}};
  if(input.channelType==="open_other")return{executedConsumerId:binding.consumerId,executedCaseId:binding.harnessCaseId,moduleExecutionId:MODULE_EXECUTION_ID,assertionCount:1,reply:"NO_REPLY",result:JSON.stringify({accepted:false,reason:"CHANNEL_NOT_ALLOWED",evaluatorRuns:0,outboxCount:0,externalReplyCount:0}),databaseEvidence:{state:args.initialState??{receipts:{},nextOutboxId:700},calls:[],evaluatorRuns:0,outboxCount:0,externalReplyCount:0,sourceDomainDmlCount:0}};
  const runtime=makeDatabase(binding,args.initialState),counters={evaluatorRuns:0,error:null},externalReplies=[];
  const environmentContext=await verifyStartupDatabaseIdentity(runtime.database,createEnvironmentContext({environmentCode:input.environmentCode,databaseIdentity:"wave16_direct"}));
  const config=loadConfig({NODE_ENV:"test",HOIBOT_ENVIRONMENT_CODE:input.environmentCode,IRIS_SHARED_TOKEN:"wave16-direct-token",USER_VERIFICATION_PEPPER:"wave16-direct-pepper",DATABASE_ENABLED:"true",DATABASE_HOST:"127.0.0.1",DATABASE_PORT:"3339",DATABASE_USER:"unused",DATABASE_PASSWORD:"unused",DATABASE_NAME:"wave16_direct"});
  process.env.PARTIAL_COMMAND_DISPATCH_ENABLED="true";
  const channelDecision=input.channelType==="open_direct"?{mode:"denied",channelClass:"open_direct",reason:"open_direct_unverified",evidence:{roomType:"DirectChat",linkId:"wave16-direct"}}:{mode:"operational",channelClass:"open_group",reason:"allowed",evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}};
  const app=buildApp(config,{database:runtime.database,environmentContext,inspectIrisChannel:async()=>channelDecision,petSkillInfoReadOnlyRecoveryProvider:makeRecovery(runtime.state,runtime.transaction,runtime.calls,counters),petSkillInfoActorContextProvider:{resolve:async()=>Object.freeze({selectionSource:"ACTIVE_CONTEXT",platformCode:"kakao",externalContextId:"wave16-channel",externalIdentityId:"12",selectedLegacyPlayerId:"21",selectedCanonicalPlayerId:"playr001",entitlementLegacyPlayerId:"21",portalAccountId:"portal01",platformContextMembershipId:"membr001",selectionVersion:"1"})},sendIrisTextReply:async reply=>externalReplies.push(reply)});
  const providerEventId=args.providerEventId??`wave16-${binding.scenarioKind.toLowerCase()}`,payload={msg:input.rawMessage,room:"Wave16 펫스킬정보방",sender:"호이 남",json:{_id:providerEventId,chat_id:"wave16-channel",user_id:input.passCode===null?"wave16-no-pass":"wave16-user"}};
  let response;try{response=await app.inject({method:"POST",url:"/api/v1/integrations/iris/events?token=wave16-direct-token",payload});}finally{delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;await app.close();}
  const body=JSON.parse(response.body),stored=Object.values(runtime.state.receipts)[0],reply=stored?.reply?.data??"NO_REPLY",outboxCount=Object.values(runtime.state.receipts).filter(value=>value.reply!==undefined).length;
  const resultValue={accepted:response.statusCode===202&&!body.ignored,reason:body.ignoreReason??null,terminalStatus:stored?.terminalStatus??null,evaluatorRuns:counters.evaluatorRuns,outboxCount,externalReplyCount:externalReplies.length,duplicate:body.duplicate??false};
  assert(externalReplies.length===0,"Wave16 HTTP path invoked immediate external reply");
  if(expected.reply!==undefined)assert(reply===expected.reply,`Wave16 exact reply drift for ${binding.scenarioKind}: ${JSON.stringify({reply,body,stored,receiptKeys:Object.keys(runtime.state.receipts),evaluationError:counters.error})}`);
  const sourceTables=new Set(["canonical_pet_skill_definitions","canonical_pet_skill_aliases","canonical_pet_skill_draw_grade_policies","canonical_owned_pet_skill_stacks","canonical_owned_pet_skill_equipment","player_support_passes"]),sourceDomainDmlCount=runtime.calls.filter(call=>DML.test(call.normalizedSql)&&[...sourceTables].some(table=>new RegExp(`(?:INTO|UPDATE|FROM) ${table}\\b`,`i`).test(call.normalizedSql))).length;
  return{executedConsumerId:binding.consumerId,executedCaseId:binding.harnessCaseId,moduleExecutionId:MODULE_EXECUTION_ID,assertionCount:2,reply,result:JSON.stringify(resultValue),databaseEvidence:{state:runtime.state,calls:runtime.calls,evaluatorRuns:counters.evaluatorRuns,outboxCount,externalReplyCount:externalReplies.length,sourceDomainDmlCount}};
}
