import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const MODULE_EXECUTION_ID=randomUUID();
const TARGETS={
 "runtime-dispatch-722afb15e9cbd92c":["home/home-furniture-info-read-service.ts","isHomeFurnitureInfoReadCandidate","HomeFurnitureInfoReadService","home_furniture_info_read"],
 "runtime-dispatch-c3cb8d18613c2358":["home/home-furniture-stats-read-service.ts","isHomeFurnitureStatsReadCommand","HomeFurnitureStatsReadService","home_furniture_stats_read"],
};
const SOURCE_TABLES=new Set(["furniture_inventory_instances","furniture_definitions","player_homes","player_passes","player_pets","pet_skills","skill_definitions","home_furniture_equip_policy"]);
const canonical=(path)=>readFileSync(path,"utf8").replace(/\r\n?/g,"\n");
const sha=(text)=>createHash("sha256").update(text).digest("hex");
const assert=(value,message)=>{if(!value)throw new Error(message);};
const equal=(left,right)=>JSON.stringify(left)===JSON.stringify(right);

export async function executeWave11HomeFurnitureRead(args){
 let assertionCount=0;const check=(value,message)=>{assertionCount+=1;assert(value,message);};
 const parityCase=args.fixturePayload.cases.find(entry=>entry.caseId===args.harnessCaseId),consumer=parityCase?.consumers.find(entry=>entry.consumerId===args.consumerId),target=TARGETS[args.consumerId];
 check(Boolean(parityCase&&consumer&&target),"Wave11 case mapping drift");
 const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../../.."),appSource=canonical(resolve(root,consumer.sourceLocator.file)),span=appSource.slice(consumer.sourceLocator.start,consumer.sourceLocator.end);
 check(sha(span)===consumer.sourceLocator.sha256&&span.includes(target[3]),"Wave11 app dispatch span drift");
 for(const locator of consumer.chainLocators){const source=canonical(resolve(root,locator.file)),located=source.slice(locator.start,locator.end);check(sha(located)===locator.sha256&&located.includes(locator.needle),`Wave11 chain drift: ${locator.file}`);}
 const serviceModule=await tsImport(pathToFileURL(resolve(root,`개발환경_고도화/runtime/src/${target[0]}`)).href,import.meta.url),Service=serviceModule[target[2]],guard=serviceModule[target[1]],input=consumer.scenarioInputsByScenario[args.scenarioKind];
 check(typeof Service==="function"&&typeof guard==="function","Wave11 production service export drift");
 check(guard(input.message)===(args.scenarioKind!=="NEGATIVE_GUARD"),"Wave11 command guard drift");
 const expected=consumer.httpOracleByScenario[args.scenarioKind],evidenceRows={...expected.evidenceRowsBefore},evidenceTables=new Set(Object.keys(evidenceRows)),domainMutations=[];let serviceInvocationCount=0;
 const originalRead=Service.prototype.read,originalExecute=args.database.execute.bind(args.database),originalWithTransaction=args.database.withTransaction.bind(args.database);
 Service.prototype.read=async function(...parameters){serviceInvocationCount+=1;return originalRead.apply(this,parameters);};
 args.database.execute=async(sql,values=[])=>{const result=await originalExecute(sql,values),normalized=String(sql).replace(/\s+/g," ").trim(),table=/^(?:INSERT INTO|UPDATE|DELETE FROM)\s+([A-Za-z0-9_]+)/i.exec(normalized)?.[1];if(table!==undefined&&evidenceTables.has(table)&&/^INSERT INTO/i.test(normalized))evidenceRows[table]+=Number(result.affectedRows);if(table!==undefined&&SOURCE_TABLES.has(table))domainMutations.push(normalized);return result;};
 args.database.withTransaction=async(work)=>{const state={...evidenceRows},domainCount=domainMutations.length;try{return await originalWithTransaction(transaction=>work(transaction));}catch(error){Object.assign(evidenceRows,state);domainMutations.length=domainCount;throw error;}};
 const before={...evidenceRows},sentReplies=[];let response;
 try{
  const configModule=await tsImport(pathToFileURL(resolve(root,"개발환경_고도화/runtime/src/config.ts")).href,import.meta.url),appModule=await tsImport(pathToFileURL(resolve(root,"개발환경_고도화/runtime/src/app.ts")).href,import.meta.url),token="wave11-in-memory-token",wrong=args.scenarioKind==="WRONG_OPERATIONAL_CHANNEL";
  const app=appModule.buildApp(configModule.loadConfig({NODE_ENV:"test",HOIBOT_ENVIRONMENT_CODE:"dev",IRIS_SHARED_TOKEN:token,USER_VERIFICATION_PEPPER:"wave11-in-memory-pepper",DATABASE_ENABLED:"true",DATABASE_HOST:"127.0.0.1",DATABASE_PORT:"3306",DATABASE_USER:"unused",DATABASE_PASSWORD:"unused",DATABASE_NAME:"unused"}),{database:args.database,inspectIrisChannel:async()=>wrong?{mode:"denied",channelClass:"open_group",reason:"not_designated",evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}}:{mode:"operational",channelClass:"open_group",reason:"allowed",evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}},sendIrisTextReply:async(reply)=>{sentReplies.push(reply);},sendIrisImageReply:async()=>{throw new Error("Wave11 unexpected image reply");}});
  try{response=await app.inject({method:"POST",url:`/api/v1/integrations/iris/events?token=${token}`,payload:{msg:input.message,room:"Wave11 가구방",json:{_id:input.providerEventId,chat_id:input.destinationId,user_id:input.externalUserId}}});}finally{await app.close();}
 }finally{Service.prototype.read=originalRead;args.database.execute=originalExecute;args.database.withTransaction=originalWithTransaction;}
 const after={...evidenceRows},body=JSON.parse(response.body);
 check(response.statusCode===expected.statusCode,"Wave11 HTTP status drift");
 check(body.accepted===expected.accepted&&body.ignored===expected.ignored&&(body.channelMode??null)===expected.channelMode&&(body.duplicate??false)===expected.duplicate,"Wave11 HTTP semantics drift");
 check(serviceInvocationCount===expected.serviceInvocationCount,"Wave11 service invocation count drift");
 check(equal(before,expected.evidenceRowsBefore)&&equal(after,expected.evidenceRowsAfter),"Wave11 evidence row snapshot drift");
 check(equal(sentReplies,expected.sentReplies),"Wave11 callback bytes drift");
 check(domainMutations.length===0,"Wave11 source-domain DML detected");
 if(["NEGATIVE_GUARD","APP_INBOX_DUPLICATE","WRONG_OPERATIONAL_CHANNEL"].includes(args.scenarioKind))check(serviceInvocationCount===0,"Wave11 rejected ingress invoked service");
 if(args.scenarioKind==="NON_ADMIN_INFO"&&args.consumerId==="runtime-dispatch-722afb15e9cbd92c")check(serviceInvocationCount===1&&equal(after,{operations:0,outbox_messages:0,command_executions:0,command_audit:0}),"Wave11 non-admin info behavior drift");
 if(args.scenarioKind==="VERIFIED_USER_LINKAGE_GAP"&&args.consumerId==="runtime-dispatch-c3cb8d18613c2358")check(serviceInvocationCount===1&&after.operations===1&&sentReplies.length===1,"Wave11 stats VERIFIED_USER linkage-gap behavior drift");
 if(args.scenarioKind==="APP_INBOX_DUPLICATE")check(equal(after,before),"Wave11 inbox duplicate changed business evidence");
 const reply=sentReplies[0]?.data??expected.noReplyCode,result=JSON.stringify({statusCode:response.statusCode,accepted:body.accepted,ignored:body.ignored,channelMode:body.channelMode??null,duplicate:body.duplicate??false,serviceInvocationCount,evidenceRowsBefore:before,evidenceRowsAfter:after,sentReplies});
 check(reply===consumer.expectedReplyByScenario[args.scenarioKind],"Wave11 exact reply bytes drift");
 check(result===consumer.expectedResultsByScenario[args.scenarioKind],"Wave11 exact ingress result drift");
 if(args.consumerId==="runtime-dispatch-722afb15e9cbd92c"&&["READ_POSITIVE","EXACT_OUTPUT","SOURCE_DOMAIN_DML_ZERO","RESTART_CONSISTENCY"].includes(args.scenarioKind)){check(reply.includes("1,234,567💕")&&reply.includes("3,345,678💕")&&reply.includes("6. 여섯번째 장롱🗄️")&&reply.includes("\u200b".repeat(500)),"Wave11 info formatting/6th allsee drift");}
 if(args.consumerId==="runtime-dispatch-c3cb8d18613c2358"&&["READ_POSITIVE","EXACT_OUTPUT","SOURCE_DOMAIN_DML_ZERO","RESTART_CONSISTENCY"].includes(args.scenarioKind)){check(reply.includes("총합: 8개")&&reply.indexOf("B [25.0%]")<reply.indexOf("C [25.0%]")&&reply.includes("A [37.5%]: 3개")&&reply.includes("\u200b".repeat(500)),"Wave11 stats tie/percentage/order/allsee drift");}
 return{executedConsumerId:args.consumerId,executedCaseId:args.harnessCaseId,moduleExecutionId:MODULE_EXECUTION_ID,assertionCount,reply,result};
}
