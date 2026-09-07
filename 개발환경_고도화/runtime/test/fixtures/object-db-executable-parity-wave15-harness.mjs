import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CONSUMER="legacy-0a10ef65ad4b37cd",TARGET="object-db-executable-parity-wave15-pet-skill-info-private-dev.mjs";
const DML=/^(?:INSERT|UPDATE|DELETE|REPLACE|MERGE|TRUNCATE)\b/i;
const SOURCE_TABLES=new Set(["canonical_pet_skill_definitions","canonical_pet_skill_aliases","canonical_pet_skill_draw_grade_policies","canonical_owned_pet_skill_stacks","canonical_owned_pet_skill_equipment","player_support_passes"]);
const assert=(value,message)=>{if(!value)throw new Error(message);};
const normalize=sql=>String(sql).replace(/\s+/g," ").trim();
const safe=value=>typeof value==="bigint"?value.toString():Array.isArray(value)?value.map(safe):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).map(([key,child])=>[key,safe(child)])):value;
const clone=value=>structuredClone(value);
const hash=value=>createHash("sha256").update(value.replace(/\r\n?/g,"\n"),"utf8").digest("hex");
function gitBlob(root,commit,path){return execFileSync("git",["show",`${commit}:${path}`],{cwd:root,encoding:"utf8",maxBuffer:8*1024*1024});}
function dmlTable(statement){const match=statement.match(/^(?:INSERT(?:\s+IGNORE)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE(?:\s+TABLE)?)\s+([A-Za-z0-9_]+)/i);if(DML.test(statement)&&match===null)throw new Error(`Wave15 unparsed DML: ${statement}`);return match?.[1]??null;}

function initialState(value){return value===undefined?{inbox:new Map(),claims:new Map(),operations:new Map(),executions:new Map(),outboxes:new Map(),next:100n}:{
  inbox:new Map(value.inbox),claims:new Map(value.claims),operations:new Map(value.operations),executions:new Map(value.executions),outboxes:new Map(value.outboxes),next:BigInt(value.next)};}
function exported(state){return{inbox:[...state.inbox],claims:[...state.claims],operations:[...state.operations],executions:[...state.executions],outboxes:[...state.outboxes],next:String(state.next)};}

async function createDatabase(initial,binding){
  let state=initialState(initial),calls=[],transactions=[],handlerInvocations=0;const attempts=[];
  const input=binding.input,expected=binding.expected;
  const record=(channel,sql,values=[],rowCount=0)=>{const normalizedSql=normalize(sql);calls.push({channel,normalizedSql,values:safe(values),rowCount});return normalizedSql;};
  const query=async(sql,values=[])=>{const n=record("query",sql,values);
    if(n==="SELECT DATABASE() AS database_identity")return[{database_identity:"wave15_formal"}];
    if(n.includes("FROM command_aliases a")){if(String(values[0]).startsWith("/펫스킬정보"))return[{command_code:"PET_SKILL_INFO",handler_key:"pet_skill_info",auth_scope:"VERIFIED_USER",rollout_state:"SHADOW"}];return[];}
    if(n.includes("SELECT error_code,processing_status FROM event_inbox")){const row=state.inbox.get(String(values[0]));return row?[{error_code:row.error_code,processing_status:row.processing_status}]:[];}
    if(n.startsWith("SELECT provider_code,provider_event_id")){const row=state.inbox.get(String(values[0]));return row?[row]:[];}
    if(n.includes("FROM event_inbox")&&n.includes("FOR UPDATE")){const row=state.inbox.get(String(values[0]));return row?[row]:[];}
    if(n.startsWith("SELECT id FROM channels"))return[{id:11n}];
    if(n.startsWith("SELECT id FROM external_identities"))return[{id:12n}];
    if(n.includes("FROM external_identity_names"))return[];
    if(n.startsWith("SELECT request_namespace FROM canonical_app_wiring_operations"))return[...state.claims.values()].filter(row=>row.entrypoint_kind===values[0]&&row.external_request_id===values[1]&&row.request_namespace!==values[2]).slice(0,1).map(row=>({request_namespace:row.request_namespace}));
    if(n.includes("FROM canonical_app_wiring_operations WHERE request_identity_fingerprint")){const row=state.claims.get(String(values[0]));return row?[row]:[];}
    if(n.includes("FROM operations operation JOIN command_executions")){const rows=[...state.operations.values()].filter(row=>n.includes("WHERE operation.id=?")?String(row.operation_id)===String(values[0]):row.idempotency_key===values[0]);return rows.flatMap(row=>{const execution=state.executions.get(String(row.operation_id));return execution?[{...row,...execution,outbox_id:null}]:[];}).slice(0,2);}
    if(n.includes("identity.status identity_status")&&n.includes("FROM external_identities identity"))return[{identity_id:12n,player_id:21n,identity_status:"linked",player_status:"active"}];
    if(n.startsWith("SELECT DATE_FORMAT(UTC_TIMESTAMP"))return[{kst_today:"2026-09-07"}];
    if(n.includes("FROM player_support_passes pass"))return input.passCode===null?[]:[{pass_id:31n,pass_code:input.passCode??"hoi",entitlement_kind:"permanent",end_date:null,pass_status:"active",definition_active:1}];
    if(n.includes("FROM external_identities identity")&&n.includes("player_status"))return[{player_status:"active",identity_id:12n}];
    if(n.includes("FROM player_profiles profile"))return[];
    if(n.includes("FROM canonical_pet_skill_aliases"))return[];
    if(n.includes("FROM canonical_pet_skill_draw_grade_policies"))return[];
    if(n.includes("CAST(raid_charm_bonus"))return[{pet_skill_id:"skill001",raid_charm_bonus:"0",castle_charm_bonus:"0"}];
    if(n.includes("FROM canonical_pet_skill_definitions"))return[{pet_skill_id:"skill001",pet_skill_name:"청룡언월도",pet_skill_description:"삼국지 관우의 전설적인 무기입니다.",pet_skill_grade:"S",legacy_source_key:"skill_000",display_order:1,base_draw_rate:"100",fixed_draw_rate_flag:1,openable_flag:1,pet_skill_grade_emoji:"📙",required_tier_name:null,tier_exclusive_flag:0,equip_description:null,handler_key:"presentation_only",options_json:{},active_flag:1}];
    throw new Error(`Wave15 unexpected SELECT: ${n}`);
  };
  const execute=async(sql,values=[])=>{const n=normalize(sql);let insertId=0n,affectedRows=1n;
    if(n.startsWith("INSERT INTO event_inbox")){const id=String(values[0]);if(!state.inbox.has(id))state.inbox.set(id,{event_id:id,provider_code:values[1],provider_event_id:values[2],external_channel_id:values[3],external_user_id:values[4],event_kind:values[5],event_origin:values[6],direction:values[7],payload_hash:values[8],error_code:values[9],processing_status:"processing",attempt_count:1,channel_id:null,external_identity_id:null});else affectedRows=0n;}
    else if(n.startsWith("UPDATE event_inbox SET channel_id")){const row=state.inbox.get(String(values[2]));if(row)Object.assign(row,{channel_id:values[0],external_identity_id:values[1]});}
    else if(n.startsWith("UPDATE event_inbox SET processing_status='processing'")){const row=state.inbox.get(String(values[2]));if(!row||row.processing_status!=="failed"||row.error_code!==values[3])affectedRows=0n;else Object.assign(row,{processing_status:"processing",error_code:values[0],attempt_count:Number(row.attempt_count)+Number(values[1])});}
    else if(n.startsWith("UPDATE event_inbox SET processing_status='processed'")){const row=state.inbox.get(String(values[0]));if(row)Object.assign(row,{processing_status:"processed",error_code:null});}
    else if(n.startsWith("UPDATE event_inbox SET processing_status='failed'")){const row=state.inbox.get(String(values[2]));if(row)Object.assign(row,{processing_status:"failed",attempt_count:Math.max(Number(row.attempt_count),Number(values[0])),error_code:values[1]});}
    else if(n.startsWith("INSERT INTO canonical_app_wiring_operations")){const fp=String(values[1]);if(state.claims.has(fp))throw Object.assign(new Error("duplicate"),{code:"ER_DUP_ENTRY",errno:1062});const failed=n.includes("'FAILED'");state.claims.set(fp,{app_wiring_operation_id:values[0],request_identity_fingerprint:fp,request_namespace:values[2],entrypoint_kind:values[3],external_request_id:values[4],request_key:values[5],payload_fingerprint:values[6],route:values[9],reason_code:values[10],command_code:values[11],handler_key:values[12],claim_state:failed?"FAILED":"CLAIMED",effect_mode:"READ_ONLY",lease_token:failed?null:values[13],lease_generation:failed?0n:1n,lease_expires_time:failed?null:values[14],attempt_count:failed?values[13]:values[15],recovery_status:"NONE",recovery_code:null,result_json:null,error_code:failed?values[14]:null});}
    else if(n.startsWith("INSERT INTO operations")){insertId=++state.next;const failed=n.includes("'failed'");state.operations.set(String(insertId),{operation_id:insertId,idempotency_scope:"app-wiring.read-only-no-reply",idempotency_key:values[1],operation_status:failed?"failed":"processing",operation_result_json:failed?values[2]:null});}
    else if(n.startsWith("INSERT INTO command_executions")){const id=String(values[2]);if(state.executions.has(id))throw Object.assign(new Error("duplicate"),{code:"ER_DUP_ENTRY",errno:1062});const failed=n.includes("'failed'");state.executions.set(id,{event_id:values[0],command_code:values[1],operation_id:values[2],execution_status:failed?"failed":"completed",result_code:failed?values[3]:"no_reply"});}
    else if(n.startsWith("UPDATE operations SET status='completed'")){const row=state.operations.get(String(values[1]));if(!row)affectedRows=0n;else{if(row.operation_status==="processing")handlerInvocations+=1;Object.assign(row,{operation_status:"completed",operation_result_json:values[0]});}}
    else if(n.startsWith("UPDATE canonical_app_wiring_operations SET claim_state='COMPLETED'")){const row=[...state.claims.values()].find(value=>value.app_wiring_operation_id===values[3]);if(!row)affectedRows=0n;else Object.assign(row,{claim_state:"COMPLETED",result_json:values[0],error_code:null,lease_token:null,lease_expires_time:null});}
    else if(n.startsWith("INSERT INTO command_routing_decisions")||n.startsWith("INSERT INTO channels")||n.startsWith("INSERT INTO external_identities")||n.startsWith("INSERT INTO external_identity_names")||n.startsWith("INSERT INTO channel_memberships")||n.startsWith("INSERT INTO normalized_provider_events")||n.startsWith("INSERT INTO channel_activity_daily")){}
    else if(n.startsWith("UPDATE canonical_app_wiring_operations SET claim_state='FAILED'")){const row=[...state.claims.values()].find(value=>value.app_wiring_operation_id===values[3]);if(row)Object.assign(row,{claim_state:"FAILED",error_code:values[0],lease_token:null,lease_expires_time:null});}
    else throw new Error(`Wave15 unexpected mutation: ${n}`);
    record("execute",sql,values,Number(affectedRows));return{affectedRows,insertId};
  };
  const run=async work=>{const before=clone(state),start=calls.length;transactions.push("BEGIN");try{const value=await work(transaction);transactions.push("COMMIT");const dml=calls.slice(start).filter(call=>DML.test(call.normalizedSql));attempts.push({attemptNumber:attempts.length+1,outcome:"COMMIT",committed:true,dmlStatements:dml.map(call=>call.normalizedSql),dmlRowCount:dml.reduce((sum,row)=>sum+row.rowCount,0)});return value;}catch(error){state=before;transactions.push("ROLLBACK");const dml=calls.slice(start).filter(call=>DML.test(call.normalizedSql));attempts.push({attemptNumber:attempts.length+1,outcome:"ROLLBACK",committed:false,dmlStatements:dml.map(call=>call.normalizedSql),dmlRowCount:dml.reduce((sum,row)=>sum+row.rowCount,0)});throw error;}};
  const transaction={query,execute,withSavepoint:async work=>work(transaction)};
  const database={query,execute,withTransaction:run,withRootTransaction:run,withConsistentRootTransaction:run,withControlledTransaction:run,withReadOnlySnapshot:async work=>work({query}),ping:async()=>{},verifyRollback:async()=>true,close:async()=>{},
    evidence:()=>{const dml=calls.filter(call=>DML.test(call.normalizedSql)),latest=[...state.operations.values()].at(-1),projection=latest?.operation_result_json==null?null:JSON.parse(String(latest.operation_result_json)).receiptProjection,
      failure=[...state.executions.values()].find(row=>row.execution_status==="failed");
      return{calls,transactions,transactionAttempts:attempts,state:exported(state),handlerInvocations,projectedReply:projection?.value?.reply??null,
        terminalResult:failure?"FAILED":latest?"NO_REPLY":null,failureCode:failure?.result_code??null,operations:state.operations.size,executions:state.executions.size,
        outboxes:state.outboxes.size,sourceDomainDmlCount:dml.filter(call=>SOURCE_TABLES.has(dmlTable(call.normalizedSql))).length};}
  };
  return database;
}

async function runWorker(inputPath,targetPath){const input=JSON.parse(readFileSync(inputPath,"utf8"));assert(input.binding.consumerId===CONSUMER,"Wave15 consumer drift");assert(input.invocation.exportName==="executeWave15PetSkillInfoPrivateDev","Wave15 export drift");assert(targetPath.endsWith(TARGET),"Wave15 target drift");
  assert(hash(readFileSync(targetPath,"utf8"))===input.invocation.targetSourceSha256,"Wave15 target hash drift");
  const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../../..");
  if(input.evidenceCommit){for(const source of input.runtimeSourceHashes??[]){const committed=gitBlob(root,input.evidenceCommit,source.path);assert(hash(committed)===source.sha256,`Wave15 committed source drift: ${source.path}`);}}
  const target=await import(`${pathToFileURL(targetPath).href}?worker=${process.pid}-${randomUUID()}`),execution=await target[input.invocation.exportName]({...input,binding:input.binding,providerEventId:input.providerEventId,createDatabase:options=>createDatabase(input.initialState,input.binding,options)});
  process.stdout.write(JSON.stringify({execution:safe(execution),processId:process.pid}));
}
function worker(harness,input,target){return JSON.parse(execFileSync(process.execPath,["--import","tsx",harness,"--worker",input,target],{encoding:"utf8",timeout:60000,maxBuffer:8*1024*1024}));}
async function runMain(inputPath,outputDirectory,targetPath){const input=JSON.parse(readFileSync(inputPath,"utf8")),harness=fileURLToPath(import.meta.url),workerInput=join(outputDirectory,"worker-input.json");writeFileSync(workerInput,JSON.stringify(input));const results=[worker(harness,workerInput,targetPath)];
  if(input.binding.scenarioKind==="RESTART_CONSISTENCY"){const restart={...input,initialState:results[0].execution.databaseEvidence.state};writeFileSync(workerInput,JSON.stringify(restart));results.push(worker(harness,workerInput,targetPath));assert(results[0].processId!==results[1].processId,"Wave15 restart process reused");assert(results[1].execution.databaseEvidence.handlerInvocations===0,"Wave15 restart replay invoked handler");assert(results[1].execution.databaseEvidence.operations===1&&results[1].execution.databaseEvidence.executions===1&&results[1].execution.databaseEvidence.outboxes===0,"Wave15 restart replay cardinality drift");}
  const first=results[0].execution,calls=results.flatMap(result=>result.execution.databaseEvidence.calls),dml=calls.filter(call=>DML.test(call.normalizedSql)),lockOrder=[];for(const call of calls)if(/FOR UPDATE/i.test(call.normalizedSql))for(const match of call.normalizedSql.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z0-9_]+)/gi))if(!lockOrder.includes(match[1]))lockOrder.push(match[1]);
  const transactionAttempts=results.flatMap(result=>result.execution.databaseEvidence.transactionAttempts).map((attempt,index)=>({...attempt,attemptNumber:index+1}));
  const trace={queryTrace:calls.filter(call=>!DML.test(call.normalizedSql)),dmlTrace:dml,normalizedStatements:dml.map(call=>call.normalizedSql),rowCount:dml.reduce((sum,row)=>sum+row.rowCount,0),lockOrder,transaction:"COMMIT",transactionAttempts,timeline:results.flatMap(result=>result.execution.databaseEvidence.transactions),sourceDomainDmlCount:results.reduce((sum,result)=>sum+result.execution.databaseEvidence.sourceDomainDmlCount,0)};
  writeFileSync(join(outputDirectory,"reply.raw"),first.reply);writeFileSync(join(outputDirectory,"result.raw"),first.result);writeFileSync(join(outputDirectory,"trace.json"),JSON.stringify(trace,null,2)+"\n");writeFileSync(join(outputDirectory,"case-result.json"),JSON.stringify({format:"hoibot-object-db-consumer-parity-case-result-v1",passed:true,assertionCount:first.assertionCount,executedConsumerId:first.executedConsumerId,executedCaseId:first.executedCaseId,fixtureId:input.binding.fixtureId,scenarioId:input.binding.scenarioId,scenarioKind:input.binding.scenarioKind,invocation:input.invocation,artifacts:{replyPath:"reply.raw",resultPath:"result.raw",tracePath:"trace.json"}},null,2)+"\n");
}
const args=process.argv.slice(2);if(args[0]==="--worker")await runWorker(args[1],args[2]);else{if(args.length!==3)throw new Error("Wave15 harness arguments missing");await runMain(args[0],args[1],args[2]);}
