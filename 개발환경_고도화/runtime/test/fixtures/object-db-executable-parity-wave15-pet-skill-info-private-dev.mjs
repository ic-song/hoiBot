import { createHash, randomUUID } from "node:crypto";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { createEnvironmentContext,verifyStartupDatabaseIdentity } from "../../src/runtime/environment-context.js";

const MODULE_EXECUTION_ID=randomUUID();
const digest=value=>createHash("sha256").update(value,"utf8").digest("hex");
const assert=(value,message)=>{if(!value)throw new Error(message);};

export async function executeWave15PetSkillInfoPrivateDev(args){
  let assertionCount=0;const check=(value,message)=>{assertionCount+=1;assert(value,message);};
  const binding=args.binding,input=binding.input;
  const database=await args.createDatabase({binding});
  const token="wave15-formal-token",replies=[];
  const config=loadConfig({NODE_ENV:"test",HOIBOT_ENVIRONMENT_CODE:input.environmentCode,IRIS_SHARED_TOKEN:token,
    USER_VERIFICATION_PEPPER:"wave15-formal-pepper",DATABASE_ENABLED:"true",DATABASE_HOST:"127.0.0.1",DATABASE_PORT:"3335",
    DATABASE_USER:"unused",DATABASE_PASSWORD:"unused",DATABASE_NAME:"wave15_formal"});
  process.env.PARTIAL_COMMAND_DISPATCH_ENABLED="true";
  const channelDecision=input.channelType==="open_group"
    ?{mode:"operational",channelClass:"open_group",reason:"allowed",evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}}
    :input.channelType==="open_direct"
      ?{mode:"denied",channelClass:"open_direct",reason:"open_direct_unverified",evidence:{roomType:"DirectChat",linkId:"wave15-direct"}}
      :{mode:"denied",channelClass:"open_group",reason:"not_designated",evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}};
  const environmentContext=await verifyStartupDatabaseIdentity(database,createEnvironmentContext({environmentCode:input.environmentCode,databaseIdentity:"wave15_formal"}));
  const app=buildApp(config,{database,environmentContext,
    inspectIrisChannel:async()=>channelDecision,sendIrisTextReply:async reply=>replies.push(reply)});
  let response;
  try{response=await app.inject({method:"POST",url:`/api/v1/integrations/iris/events?token=${token}`,payload:{
    msg:input.rawMessage,room:"Wave15 펫스킬정보방",sender:"호이 남",json:{_id:args.providerEventId??`wave15-${binding.scenarioKind.toLowerCase()}`,
      chat_id:"wave15-channel",user_id:binding.scenarioKind==="AUTH_DENIED"?"wave15-no-pass":"wave15-user"}}});}
  finally{delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;await app.close();}
  const body=JSON.parse(response.body),evidence=database.evidence(),expected=binding.expected;
  const accepted=response.statusCode===202&&!body.ignored;
  check(replies.length===0,"Wave15 SHADOW emitted an external reply");
  if(typeof expected.accepted==="boolean")check(accepted===expected.accepted,`Wave15 ${binding.scenarioKind} acceptance drift`);
  if(typeof expected.handlerInvocationCount==="number")check(evidence.handlerInvocations===expected.handlerInvocationCount,`Wave15 ${binding.scenarioKind} handler count drift`);
  if(expected.terminalResult==="NO_REPLY"&&accepted)check(evidence.outboxes===0,"Wave15 NO_REPLY created outbox");
  if(expected.terminalResult==="FAILED")check(response.statusCode===500&&evidence.failureCode===expected.errorCode,`Wave15 durable failure drift: ${response.statusCode}/${evidence.failureCode}`);
  if(expected.reason!==undefined)check(evidence.reason===expected.reason,"Wave15 guard reason drift");
  const reply=evidence.projectedReply??"NO_REPLY";
  if(expected.reply!==undefined)check(reply===expected.reply,"Wave15 independent expected reply drift");
  if(binding.scenarioKind==="SOURCE_DOMAIN_DML_ZERO")check(evidence.sourceDomainDmlCount===0,"Wave15 canonical/source DML detected");
  const result=JSON.stringify({statusCode:response.statusCode,accepted,ignored:body.ignored??false,duplicate:body.duplicate??false,
    terminalResult:evidence.terminalResult,handlerInvocationCount:evidence.handlerInvocations,operationCount:evidence.operations,
    commandExecutionCount:evidence.executions,outboxCount:evidence.outboxes,replySha256:evidence.projectedReply===null?null:digest(evidence.projectedReply)});
  return{executedConsumerId:binding.consumerId,executedCaseId:binding.harnessCaseId,moduleExecutionId:MODULE_EXECUTION_ID,
    assertionCount,reply,result,databaseEvidence:evidence};
}
