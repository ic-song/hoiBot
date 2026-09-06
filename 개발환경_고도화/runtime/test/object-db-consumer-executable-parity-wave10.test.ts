import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { assertTrustedWave10ConsumerFixtureMapping, assertTrustedWave10ExecutableHashes } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const runtimeRoot=resolve(import.meta.dirname,"..");
const repositoryRoot=resolve(runtimeRoot,"../..");
const harnessPath=resolve(runtimeRoot,"test/fixtures/object-db-executable-parity-wave10-harness.mjs");
const targetPath=resolve(runtimeRoot,"test/fixtures/object-db-executable-parity-wave10-pendant-read.mjs");
const fixturePath=resolve(repositoryRoot,"개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave10-pendant-read-v1.json");
const fixture=JSON.parse(readFileSync(fixturePath,"utf8"));
const hash=(path:string)=>createHash("sha256").update(readFileSync(path,"utf8").replace(/\r\n?/g,"\n")).digest("hex");
const consumers=()=>fixture.payload.cases.flatMap((entry:any)=>entry.consumers);
function run(binding:any,payload=fixture.payload){const dir=mkdtempSync(join(tmpdir(),"hoibot-wave10-"));const input=join(dir,"input.json");writeFileSync(input,JSON.stringify({binding,fixturePayload:payload,invocation:{targetPath:"개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave10-pendant-read.mjs",targetSourceSha256:hash(targetPath),exportName:"executeWave10PendantRead"}}));let error:any;try{execFileSync(process.execPath,[harnessPath,input,dir,targetPath],{stdio:"pipe",timeout:30_000});}catch(value){error=value;}return{dir,error,trace:()=>JSON.parse(readFileSync(join(dir,"trace.json"),"utf8"))};}
function table(sql:string){return /^(?:INSERT INTO|UPDATE)\s+([A-Za-z0-9_]+)/i.exec(sql)?.[1];}

describe("Wave10 pendant executable parity",()=>{
  it("executes all 15 receipt scenarios through exact production services",()=>{for(const binding of fixture.bindings){const result=run(binding);try{assert.equal(result.error,undefined);const trace=result.trace();if(binding.scenarioKind==="NEGATIVE_GUARD"){assert.equal(trace.queryTrace.length,0);assert.equal(trace.dmlTrace.length,0);assert.equal(trace.transaction,"READ_ONLY");continue;}const repeat=binding.scenarioKind==="RESTART_CONSISTENCY"?2:1;assert.equal(trace.dmlTrace.length,5*repeat);assert.ok(trace.dmlTrace.every((entry:any)=>new Set(["operations","outbox_messages","command_executions","command_audit"]).has(table(entry.normalizedSql)!)));assert.deepEqual(trace.timeline,repeat===2?["CHILD_PROCESS_1:COMMIT","RESTART","CHILD_PROCESS_2:COMMIT"]:["BEGIN","COMMIT"]);assert.ok(trace.lockOrder.includes("operations"));if(repeat===2){const keys=trace.dmlTrace.filter((entry:any)=>entry.normalizedSql.startsWith("INSERT INTO operations")).map((entry:any)=>entry.values[0]);assert.equal(keys.length,2);assert.notEqual(keys[0],keys[1]);for(const key of keys)assert.match(key,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);}}finally{rmSync(result.dir,{recursive:true,force:true});}}});

  it("freezes negative app/service risks and exact rollback plans",()=>{for(const consumer of consumers()){
    assert.equal(consumer.mutationPlanByScenario.ROLLBACK.length,3);assert.equal(consumer.mutationPlanByScenario.ROLLBACK[2].error.code,"ER_SIGNAL_EXCEPTION");
    for(const scenario of ["SAME_EVENT_REPLAY","APP_INBOX_DUPLICATE","MISSING_IDENTITY","WRONG_OPERATIONAL_CHANNEL","PAYLOAD_DESTINATION_DRIFT"])assert.equal(consumer.mutationPlanByScenario[scenario].length,0,`${consumer.consumerId}/${scenario}`);
    assert.equal(consumer.queryPlanByScenario.APP_INBOX_DUPLICATE.length,1);assert.equal(consumer.queryPlanByScenario.WRONG_OPERATIONAL_CHANNEL.length,1);
    assert.ok(consumer.queryPlanByScenario.SAME_EVENT_REPLAY.some((step:any)=>step.expectedNormalizedSql.endsWith("FOR UPDATE")));
    assert.equal(consumer.expectedResultsByScenario.PAYLOAD_DESTINATION_DRIFT,consumer.expectedResultsByScenario.SAME_EVENT_REPLAY);
  }});

  it("pins 13 probability rows summing exactly 100 and BIGINT pendant identities",()=>{const probability=consumers().find((entry:any)=>entry.consumerId==="runtime-dispatch-19076db78c2eefb9");const step=probability.queryPlanByScenario.READ_POSITIVE.find((entry:any)=>entry.rows.length===13);assert.equal(step.rows.reduce((sum:number,row:any)=>sum+Number(row.rate),0),100);const market=consumers().find((entry:any)=>entry.consumerId==="runtime-dispatch-36d6721ade0707a6");assert.ok(JSON.stringify(market.queryPlanByScenario.READ_POSITIVE).includes("9223372036854775806"));});

  it("preserves all 119 prior receipts by exact prefix/hash identity",()=>{const prior=JSON.parse(readFileSync(resolve(repositoryRoot,"개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave9-v1.json"),"utf8"));const current=JSON.parse(readFileSync(resolve(repositoryRoot,"개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave10-v1.json"),"utf8"));assert.equal(prior.receipts.length,119);assert.equal(current.receipts.length,134);assert.deepEqual(current.receipts.slice(0,119),prior.receipts);assert.equal(new Set(current.receipts.map((entry:any)=>entry.receiptId)).size,134);});

  it("fails closed on canonical fixture and executable tampering",()=>{const manifest=JSON.parse(readFileSync(resolve(repositoryRoot,"개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json"),"utf8"));for(const consumer of consumers()){const source=manifest.consumers.find((entry:any)=>entry.consumerId===consumer.consumerId);assert.doesNotThrow(()=>assertTrustedWave10ConsumerFixtureMapping(consumer.consumerId,consumer,source));for(const mutate of [(value:any)=>value.queryPlanByScenario.READ_POSITIVE[0].expectedNormalizedSql+=" ",(value:any)=>value.expectedResultsByScenario.EXACT_OUTPUT="{}",(value:any)=>value.sourceLocator.start+=1]){const changed=structuredClone(consumer);mutate(changed);assert.throws(()=>assertTrustedWave10ConsumerFixtureMapping(consumer.consumerId,changed,source),/contract drift/);}}const harness=hash(harnessPath),target=hash(targetPath);assert.doesNotThrow(()=>assertTrustedWave10ExecutableHashes(harness,target));assert.throws(()=>assertTrustedWave10ExecutableHashes("0".repeat(64),target),/source hash drift/);});

  it("fails closed when app span, SQL, row or output bytes drift",()=>{for(const original of consumers())for(const mutate of [(value:any)=>value.sourceLocator.sha256="0".repeat(64),(value:any)=>value.queryPlanByScenario.READ_POSITIVE[0].expectedValues=["drift"],(value:any)=>value.expectedResultsByScenario.READ_POSITIVE="{}"]){const payload=structuredClone(fixture.payload);const changed=payload.cases.flatMap((entry:any)=>entry.consumers).find((entry:any)=>entry.consumerId===original.consumerId);mutate(changed);const binding=fixture.bindings.find((entry:any)=>entry.consumerId===original.consumerId&&entry.scenarioKind==="READ_POSITIVE");const result=run(binding,payload);try{assert.ok(result.error);}finally{rmSync(result.dir,{recursive:true,force:true});}}});
});
