import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CONSUMER = "legacy-e038a86d8e885624";
const TARGET = "object-db-executable-parity-wave14-pet-skill-probability.mjs";
const DML = /^(?:INSERT|UPDATE|DELETE|REPLACE|MERGE|TRUNCATE)\b/i;
const SOURCE_TABLES = new Set(["canonical_pet_skill_definitions","canonical_pet_skill_aliases","canonical_pet_skill_draw_grade_policies"]);
const assert = (value,message) => { if (!value) throw new Error(message); };
const normalize = sql => String(sql).replace(/\s+/g," ").trim();
const safe = value => typeof value === "bigint" ? value.toString() : Array.isArray(value) ? value.map(safe)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key,child])=>[key,safe(child)])) : value;

function gitBlob(root,commit,path){return execFileSync("git",["show",`${commit}:${path}`],{cwd:root,encoding:"utf8",maxBuffer:4*1024*1024});}
function legacyName(name){let value=String(name??"").replace(/^\[펫스킬북\]/,"").replace(/📙/g,"").replace(/✨/g,"").trim();value=({"하느님위에갓물주":"하느님 위에 갓물주","야수의본능":"야수의 본능","종의본능":"종의 본능","펫스킬학개론":"펫스킬 학개론","호이행복재단회원권":"호이행복재단 회원권","로열하우스":"로열 하우스","길드의심장":"길드의 심장","전투형지휘관":"전투형 지휘관","기사단증원":"기사단 증원","타고난장사꾼":"타고난 장사꾼","티어상승론":"티어 상승론","망한건맞아":"망한건 맞아","광산 탐험가":"광산탐험가","던전 탐험가":"던전탐험가"})[value]??value;return value?`${value}📙`:"";}
function legacyOracle(entries){const grades=["SS","S","A","B","C","D"],totals={S:10.5,A:18.1,B:20,C:47.7},weight=row=>{if(row.source.openable===false)return 0;const gradeTotal=totals[row.source.grade];if(gradeTotal===undefined)return row.source.rate||0;if(row.source.fixedRate===true)return row.source.rate||0;const gradeRows=entries.filter(item=>item.source.grade===row.source.grade),fixed=gradeRows.filter(item=>item.source.fixedRate===true).reduce((sum,item)=>sum+(Number(item.source.rate)||0),0),flex=gradeRows.filter(item=>item.source.fixedRate!==true).length;return flex>0?Math.max(0,gradeTotal-fixed)/flex:0;},weightTotal=entries.reduce((sum,row)=>sum+weight(row),0);let output=`📙 펫스킬북 확률표 📙\n\n${"\u200b".repeat(500)}\n`,total=0;for(const grade of grades){output+=`━━━${grade} 등급━━━\n`;for(const row of entries.filter(item=>item.source.grade===grade)){const rate=weight(row)/weightTotal*100;total+=rate;output+=`${legacyName(row.source.name)} (확률: ${rate.toFixed(1)}%)\n`;}output+="\n";}return `${output}━━━━━━━━━━━━━━━\n총 확률: ${total.toFixed(1)}%`.trim();}
async function canonicalRows(root,evidenceCommit) {
  const baselinePath="개발환경_고도화/migration-control/fixtures/synthetic-relational/pet-skill-definitions-v2400.json",additionsPath="개발환경_고도화/migration-control/fixtures/synthetic-relational/pet-skill-post-freeze-v2435.json";
  const baseline=JSON.parse(gitBlob(root,evidenceCommit,baselinePath)),additions=JSON.parse(gitBlob(root,evidenceCommit,additionsPath));
  const entries=[...baseline];for(const row of [...additions.rows].sort((a,b)=>a.runtimeSourceIndex-b.runtimeSourceIndex))entries.splice(row.runtimeSourceIndex,0,row);
  assert(entries.length===93&&additions.sourceRef==="8f075b4ef249543563e3338e8f3dd32046344880","Wave14 frozen legacy source drift");
  const expectedReply=legacyOracle(entries);assert(expectedReply.length===2630&&Buffer.byteLength(expectedReply,"utf8")===5494&&createHash("sha256").update(expectedReply).digest("hex")==="4b1c023c26f0481d849044790b42d38a79d611b8971ee243af947ea0b2a9536a","Wave14 independent oracle drift");
  const ids=new Map(entries.map((row,index)=>[row.sourceKey,`ps${String(index+1).padStart(6,"0")}`]));
  return {
    expectedReply,
    definitions:entries.map((row,index)=>({pet_skill_id:ids.get(row.sourceKey),pet_skill_name:row.source.name,
      pet_skill_description:row.source.effect,pet_skill_grade:row.source.grade,legacy_source_key:row.sourceKey,display_order:index+1,
      base_draw_rate:String(row.source.rate??0),fixed_draw_rate_flag:row.source.fixedRate===true?1:0,openable_flag:row.source.openable===false?0:1,
      pet_skill_grade_emoji:"📙",required_tier_name:row.source.requiredTier??null,tier_exclusive_flag:row.source.tierExclusive===true?1:0,
      equip_description:row.source.equipComment??null,handler_key:"presentation_only",options_json:{},active_flag:1})),
    aliases:entries.filter(row=>row.source.tierExclusive===true&&row.source.name.includes(" ")).map((row,index)=>{const alias=row.source.name.slice(row.source.name.indexOf(" ")+1).trim();return{pet_skill_alias_id:`pa${String(index+1).padStart(6,"0")}`,pet_skill_id:ids.get(row.sourceKey),alias_value:alias,normalized_alias_value:alias.normalize("NFKC").replace(/^\[펫스킬북\]/,"").replace(/[\s✨📙]/g,"").toLocaleLowerCase("ko-KR")};}),
    policies:Object.entries({S:10.5,A:18.1,B:20,C:47.7}).map(([grade,total],index)=>({pet_skill_draw_grade_policy_id:`pp${String(index+1).padStart(6,"0")}`,pet_skill_grade:grade,grade_probability_total:String(total),display_order:index+1}))
  };
}

function exportState(state){return{inbox:[...state.inbox],executions:[...state.executions],operations:[...state.operations],outboxes:[...state.outboxes],audits:state.audits??0,next:String(state.next)};}
function importState(value){return value===undefined?{inbox:new Map(),executions:new Map(),operations:new Map(),outboxes:new Map(),audits:0,next:100n}:{inbox:new Map(value.inbox),executions:new Map(value.executions),operations:new Map(value.operations),outboxes:new Map(value.outboxes),audits:value.audits??0,next:BigInt(value.next)};}
function dmlTable(statement){const match=statement.match(/^(?:INSERT(?:\s+IGNORE)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE(?:\s+TABLE)?)\s+([A-Za-z0-9_]+)/i);if(DML.test(statement)&&match===null)throw new Error(`Wave14 unparsed DML: ${statement}`);return match?.[1];}
async function createStatefulDatabase(root,evidenceCommit,initialState) {
  const catalog=await canonicalRows(root,evidenceCommit),calls=[],transactions=[];
  let state=importState(initialState);state.audits=state.audits??0;const attempts=[];
  let queue=Promise.resolve();
  const record=(channel,sql,values,rowCount)=>{const normalizedSql=normalize(sql);calls.push({channel,normalizedSql,values:safe(values),rowCount});return normalizedSql;};
  const clone=source=>structuredClone(source);
  const transaction={
    async query(sql,values=[]){const n=record("query",sql,values,0);
      if(n.includes("FROM command_aliases a"))return values[0]==="/펫스킬확률"?[{command_code:"PET_SKILL_PROBABILITY",handler_key:"pet_skill_probability",auth_scope:"VERIFIED_USER",rollout_state:"ACTIVE"}]:[];
      if(n.includes("FROM command_executions execution")&&n.includes("JOIN operations operation")){const row=state.executions.get(values[0]);return row?[{result_json:state.operations.get(row.operationId).result_json}]:[];}
      if(n==="SELECT error_code FROM event_inbox WHERE event_id=? FOR UPDATE"){const row=state.inbox.get(values[0]);return row?[{error_code:row.error_code}]:[];}
      if(n.startsWith("SELECT id FROM channels"))return [{id:1n}];
      if(n.startsWith("SELECT id FROM external_identities"))return [{id:10n}];
      if(n.startsWith("SELECT display_name FROM external_identity_names"))return [];
      if(n.startsWith("SELECT provider_code,provider_event_id")){const row=state.inbox.get(values[0]);return row?[row]:[];}
      if(n.includes("FROM external_identities identity")&&n.includes("JOIN players player")){const user=String(values[0]);if(user==="user-ok")return[{identity_id:10n,player_id:20n,player_status:"active"}];if(user==="user-stop")return[{identity_id:11n,player_id:21n,player_status:"suspended"}];return[];}
      if(n.includes("FROM canonical_pet_skill_definitions"))return catalog.definitions;
      if(n.includes("FROM canonical_pet_skill_aliases"))return catalog.aliases;
      if(n.includes("FROM canonical_pet_skill_draw_grade_policies"))return catalog.policies;
      if(n.startsWith("SELECT attempt_count + 1 AS next_attempt FROM outbox_messages")){const row=state.outboxes.get(String(values[0]));return[{next_attempt:BigInt((row?.attempts??0)+1)}];}
      throw new Error(`Wave14 unexpected SELECT: ${n}`);
    },
    async execute(sql,values=[]){const n=normalize(sql);let insertId=0n,affectedRows=1n;
      if(n.startsWith("INSERT INTO event_inbox")){const eventId=values[0];if(!state.inbox.has(eventId))state.inbox.set(eventId,{provider_code:values[1],provider_event_id:values[2],external_channel_id:values[3],external_user_id:values[4],payload_hash:values[8],error_code:values[9]});else affectedRows=0n;}
      else if(n.startsWith("UPDATE event_inbox SET channel_id=")){}
      else if(n.startsWith("UPDATE event_inbox SET processing_status='processed'")||n.startsWith("UPDATE event_inbox SET processing_status = 'processed'")){const row=state.inbox.get(values[0]);if(row)row.error_code=null;}
      else if(n.startsWith("INSERT INTO operations")){insertId=state.next++;state.operations.set(insertId.toString(),{result_json:null});}
      else if(n.startsWith("INSERT INTO outbox_messages")){insertId=state.next++;state.outboxes.set(insertId.toString(),{attempts:0});}
      else if(n.startsWith("INSERT INTO command_executions")){if(state.executions.has(values[0]))throw Object.assign(new Error("duplicate execution"),{code:"ER_DUP_ENTRY"});state.executions.set(values[0],{operationId:String(values[2])});}
      else if(n.startsWith("UPDATE operations SET status='completed'")){state.operations.get(String(values[1])).result_json=values[0];}
      else if(n.startsWith("INSERT INTO delivery_attempts")){const row=state.outboxes.get(String(values[0]));if(row)row.attempts+=1;}
      else if(n.startsWith("INSERT INTO command_routing_decisions")){}
      else if(n.startsWith("UPDATE outbox_messages SET status")){}
      else if(n.startsWith("INSERT INTO command_audit")){state.audits+=1;}
      else if(n.startsWith("INSERT INTO channels")||n.startsWith("INSERT INTO external_identities")||n.startsWith("INSERT INTO external_identity_names")||n.startsWith("INSERT INTO channel_memberships")||n.startsWith("INSERT INTO normalized_provider_events")||n.startsWith("INSERT INTO channel_activity_daily")){}
      else throw new Error(`Wave14 unexpected mutation: ${n}`);
      record("execute",sql,values,Number(affectedRows));return{affectedRows,insertId};
    }
  };
  const run=work=>{const pending=queue.then(async()=>{const before=clone(state),start=calls.length;transactions.push("BEGIN");try{const value=await work(transaction);transactions.push("COMMIT");const dml=calls.slice(start).filter(call=>DML.test(call.normalizedSql));attempts.push({attemptNumber:attempts.length+1,outcome:"COMMIT",committed:true,dmlStatements:dml.map(call=>call.normalizedSql),dmlRowCount:dml.reduce((sum,call)=>sum+call.rowCount,0)});return value;}catch(error){state=before;transactions.push("ROLLBACK");const dml=calls.slice(start).filter(call=>DML.test(call.normalizedSql));attempts.push({attemptNumber:attempts.length+1,outcome:"ROLLBACK",committed:false,dmlStatements:dml.map(call=>call.normalizedSql),dmlRowCount:dml.reduce((sum,call)=>sum+call.rowCount,0)});throw error;}});queue=pending.catch(()=>undefined);return pending;};
  return {query:transaction.query,execute:transaction.execute,withTransaction:run,withRootTransaction:run,ping:async()=>{},verifyRollback:async()=>true,close:async()=>{},
    evidence:()=>({calls,transactions,transactionAttempts:attempts,sourceDml:calls.filter(call=>SOURCE_TABLES.has(dmlTable(call.normalizedSql))).length,
      canonicalQueries:calls.filter(call=>call.channel==="query"&&[...SOURCE_TABLES].some(table=>call.normalizedSql.includes(`FROM ${table}`))).length,
      operations:state.operations.size,executions:state.executions.size,outboxes:state.outboxes.size,audits:state.audits,state:exportState(state),expectedReply:catalog.expectedReply})};
}

async function runWorker(inputPath,targetPath){const input=JSON.parse(readFileSync(inputPath,"utf8"));assert(input.binding.consumerId===CONSUMER,"Wave14 consumer not allowlisted");assert(input.invocation.exportName==="executeWave14PetSkillProbability","Wave14 export drift");assert(targetPath.endsWith(TARGET),"Wave14 target drift");
  const normalizedTarget=readFileSync(targetPath,"utf8").replace(/\r\n?/g,"\n"),targetHash=createHash("sha256").update(normalizedTarget).digest("hex");assert(targetHash===input.invocation.targetSourceSha256,"Wave14 target hash drift");
  const target=await import(`${pathToFileURL(targetPath).href}?worker=${process.pid}-${randomUUID()}`),root=resolve(dirname(fileURLToPath(import.meta.url)),"../../../..");
  assert(Array.isArray(input.runtimeSourceHashes)&&input.runtimeSourceHashes.length===10,"Wave14 runtime source manifest drift");for(const source of input.runtimeSourceHashes){const committed=gitBlob(root,input.evidenceCommit,source.path).replace(/\r\n?/g,"\n"),disk=readFileSync(resolve(root,source.path),"utf8").replace(/\r\n?/g,"\n");assert(createHash("sha256").update(committed).digest("hex")===source.sha256&&createHash("sha256").update(disk).digest("hex")===source.sha256,`Wave14 runtime import-chain drift: ${source.path}`);}
  const oracle=await canonicalRows(root,input.evidenceCommit);const execution=await target[input.invocation.exportName]({...input.binding,fixturePayload:input.fixturePayload,legacyExpectedReply:oracle.expectedReply,createDatabase:()=>createStatefulDatabase(root,input.evidenceCommit,input.initialState)});
  process.stdout.write(JSON.stringify({execution:safe(execution),processId:process.pid}));}

function worker(harness,input,target){return JSON.parse(execFileSync(process.execPath,[harness,"--worker",input,target],{encoding:"utf8",timeout:30000,maxBuffer:4*1024*1024}));}
async function runMain(inputPath,outputDirectory,targetPath){const input=JSON.parse(readFileSync(inputPath,"utf8")),harness=fileURLToPath(import.meta.url),workerInput=join(outputDirectory,"worker-input.json");writeFileSync(workerInput,JSON.stringify(input));const results=[worker(harness,workerInput,targetPath)];if(input.binding.scenarioKind==="RESTART_CONSISTENCY"){const payload=structuredClone(input.fixturePayload),scenario=payload.cases[0].consumers[0].scenarioInputsByScenario.RESTART_CONSISTENCY;scenario.providerEventId=`${scenario.providerEventId}-after-restart`;const restartInput={...input,fixturePayload:payload,initialState:results[0].execution.databaseEvidence.state};writeFileSync(workerInput,JSON.stringify(restartInput));results.push(worker(harness,workerInput,targetPath));}
  const first=results[0].execution;if(results.length===2){assert(results[0].processId!==results[1].processId,"Wave14 restart process reused");assert(results[0].execution.moduleExecutionId!==results[1].execution.moduleExecutionId,"Wave14 restart module reused");assert(results[1].execution.reply===first.reply&&results[1].execution.result.replace(/"replyCount":1/, '"replyCount":1')===first.result,"Wave14 restart output drift");assert(results[1].execution.databaseEvidence.executions===2&&results[1].execution.databaseEvidence.outboxes===2,"Wave14 restart state preservation drift");}
  const calls=results.flatMap(result=>result.execution.databaseEvidence.calls),dml=calls.filter(call=>DML.test(call.normalizedSql)),lockOrder=[];for(const call of calls)if(/FOR UPDATE/i.test(call.normalizedSql))for(const match of call.normalizedSql.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z0-9_]+)/gi))if(!lockOrder.includes(match[1]))lockOrder.push(match[1]);
  const trace={queryTrace:calls.filter(call=>!DML.test(call.normalizedSql)),dmlTrace:dml,normalizedStatements:dml.map(call=>call.normalizedSql),rowCount:dml.reduce((sum,call)=>sum+call.rowCount,0),lockOrder,transaction:"COMMIT",transactionAttempts:results.flatMap(result=>result.execution.databaseEvidence.transactionAttempts).map((attempt,index)=>({...attempt,attemptNumber:index+1})),timeline:results.flatMap(result=>result.execution.databaseEvidence.transactions),sourceDomainDmlCount:results.reduce((sum,result)=>sum+result.execution.databaseEvidence.sourceDml,0)};
  writeFileSync(join(outputDirectory,"reply.raw"),first.reply);writeFileSync(join(outputDirectory,"result.raw"),first.result);writeFileSync(join(outputDirectory,"trace.json"),JSON.stringify(trace,null,2)+"\n");writeFileSync(join(outputDirectory,"case-result.json"),JSON.stringify({format:"hoibot-object-db-consumer-parity-case-result-v1",passed:true,assertionCount:first.assertionCount,executedConsumerId:first.executedConsumerId,executedCaseId:first.executedCaseId,fixtureId:input.binding.fixtureId,scenarioId:input.binding.scenarioId,scenarioKind:input.binding.scenarioKind,invocation:input.invocation,artifacts:{replyPath:"reply.raw",resultPath:"result.raw",tracePath:"trace.json"}},null,2)+"\n");}
const args=process.argv.slice(2);if(args[0]==="--worker")await runWorker(args[1],args[2]);else{if(args.length!==3)throw new Error("Wave14 harness arguments missing");await runMain(args[0],args[1],args[2]);}
