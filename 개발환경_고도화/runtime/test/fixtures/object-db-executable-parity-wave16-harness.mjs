import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CONSUMER="legacy-0a10ef65ad4b37cd",TARGET="object-db-executable-parity-wave16-pet-skill-info-direct-reply.mjs";
const DML=/^(?:INSERT|UPDATE|DELETE|REPLACE|MERGE|TRUNCATE)\b/i;
const assert=(value,message)=>{if(!value)throw new Error(message);};
const safe=value=>typeof value==="bigint"?value.toString():Array.isArray(value)?value.map(safe):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).map(([key,child])=>[key,safe(child)])):value;
const hash=value=>createHash("sha256").update(value.replace(/\r\n?/g,"\n"),"utf8").digest("hex");
function gitBlob(root,commit,path){return execFileSync("git",["show",`${commit}:${path}`],{cwd:root,encoding:"utf8",maxBuffer:8*1024*1024});}

async function runWorker(inputPath,targetPath){
  const input=JSON.parse(readFileSync(inputPath,"utf8"));assert(input.binding.consumerId===CONSUMER,"Wave16 consumer drift");
  assert(input.invocation.exportName==="executeWave16PetSkillInfoDirectReply","Wave16 export drift");assert(targetPath.endsWith(TARGET),"Wave16 target drift");
  assert(hash(readFileSync(targetPath,"utf8"))===input.invocation.targetSourceSha256,"Wave16 target hash drift");
  if(input.evidenceCommit){const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../../..");for(const source of input.runtimeSourceHashes??[])assert(hash(gitBlob(root,input.evidenceCommit,source.path))===source.sha256,`Wave16 committed source drift: ${source.path}`);}
  const target=await import(`${pathToFileURL(targetPath).href}?worker=${process.pid}-${randomUUID()}`),execution=await target[input.invocation.exportName](input);
  process.stdout.write(JSON.stringify({execution:safe(execution),processId:process.pid}));
}
function worker(harness,input,target){return JSON.parse(execFileSync(process.execPath,["--import","tsx",harness,"--worker",input,target],{encoding:"utf8",timeout:60000,maxBuffer:8*1024*1024}));}
async function runMain(inputPath,outputDirectory,targetPath){
  const input=JSON.parse(readFileSync(inputPath,"utf8")),harness=fileURLToPath(import.meta.url),workerInput=join(outputDirectory,"worker-input.json");writeFileSync(workerInput,JSON.stringify(input));
  const results=[worker(harness,workerInput,targetPath)];
  if(input.binding.scenarioKind==="RESTART_CONSISTENCY"){
    const restart={...input,initialState:results[0].execution.databaseEvidence.state};writeFileSync(workerInput,JSON.stringify(restart));results.push(worker(harness,workerInput,targetPath));
    assert(results[0].processId!==results[1].processId,"Wave16 restart process reused");assert(results[1].execution.databaseEvidence.evaluatorRuns===0,"Wave16 replay reran evaluator");
    assert(results[1].execution.databaseEvidence.outboxCount===1,"Wave16 replay outbox cardinality drift");assert(results[1].execution.databaseEvidence.calls.filter(call=>DML.test(call.normalizedSql)).length===0,"Wave16 replay created DML");
  }
  const first=results[0].execution,calls=results.flatMap(result=>result.execution.databaseEvidence.calls),dml=calls.filter(call=>DML.test(call.normalizedSql));
  const trace={queryTrace:calls.filter(call=>!DML.test(call.normalizedSql)),dmlTrace:dml,normalizedStatements:dml.map(call=>call.normalizedSql),rowCount:dml.reduce((sum,row)=>sum+row.rowCount,0),lockOrder:[],transaction:dml.length===0?"READ_ONLY":"COMMIT",transactionAttempts:[],timeline:dml.length===0?["READ_ONLY"]:["BEGIN","COMMIT"],sourceDomainDmlCount:results.reduce((sum,result)=>sum+result.execution.databaseEvidence.sourceDomainDmlCount,0)};
  writeFileSync(join(outputDirectory,"reply.raw"),first.reply);writeFileSync(join(outputDirectory,"result.raw"),first.result);writeFileSync(join(outputDirectory,"trace.json"),JSON.stringify(trace,null,2)+"\n");
  writeFileSync(join(outputDirectory,"case-result.json"),JSON.stringify({format:"hoibot-object-db-consumer-parity-case-result-v1",passed:true,assertionCount:first.assertionCount,executedConsumerId:first.executedConsumerId,executedCaseId:first.executedCaseId,fixtureId:input.binding.fixtureId,scenarioId:input.binding.scenarioId,scenarioKind:input.binding.scenarioKind,invocation:input.invocation,artifacts:{replyPath:"reply.raw",resultPath:"result.raw",tracePath:"trace.json"}},null,2)+"\n");
}
const args=process.argv.slice(2);if(args[0]==="--worker")await runWorker(args[1],args[2]);else{if(args.length!==3)throw new Error("Wave16 harness arguments missing");await runMain(args[0],args[1],args[2]);}
