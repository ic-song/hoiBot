import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { assertTrustedWave7ConsumerFixtureMapping } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const runtimeRoot=resolve(import.meta.dirname,".."),repositoryRoot=resolve(runtimeRoot,"../..");
const harnessPath=resolve(runtimeRoot,"test/fixtures/object-db-executable-parity-harness.mjs");
const targetPath=resolve(runtimeRoot,"test/fixtures/object-db-executable-parity-wave7-service-chain.mjs");
const fixturePath=resolve(repositoryRoot,"개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave7-service-chain-v1.json");
const readJson=(path:string):any=>JSON.parse(readFileSync(resolve(repositoryRoot,path),"utf8"));
const fixture=JSON.parse(readFileSync(fixturePath,"utf8"));
const manifest=readJson("개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json");
const consumerIds=["runtime-dispatch-f53934feccdd6d39","runtime-dispatch-f024a0ae45b58a2a","runtime-dispatch-e45c1c15e08c165a"];
const consumerFor=(consumerId:string):any=>fixture.payload.cases.flatMap((parityCase:any)=>parityCase.consumers).find((consumer:any)=>consumer.consumerId===consumerId);
const sha256Text=(path:string):string=>createHash("sha256").update(readFileSync(path,"utf8").replace(/\r\n?/g,"\n")).digest("hex");

function runBinding(binding:any,fixturePayload=fixture.payload):{outputDirectory:string;error:unknown}{
  const outputDirectory=mkdtempSync(join(tmpdir(),"hoibot-wave7-parity-")),inputPath=join(outputDirectory,"input.json");
  writeFileSync(inputPath,JSON.stringify({binding,fixturePayload,invocation:{targetPath:"개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave7-service-chain.mjs",targetSourceSha256:sha256Text(targetPath),exportName:"executeWave7ServiceChain"}}));
  let error:unknown=null;
  try{execFileSync(process.execPath,[harnessPath,inputPath,outputDirectory,targetPath],{stdio:"pipe",timeout:20_000});}catch(caught){error=caught;}
  return{outputDirectory,error};
}

describe("object DB executable parity Wave7 service-chain cohort",()=>{
  it("promotes three static runtime dispatch consumers with five direct receipts each",()=>{
    const ledger=readJson("개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.json"),receipts=readJson("개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave7-v1.json");
    assert.deepEqual(ledger.coverage,{manifestConsumers:1111,ledgerEntries:1111,provenConsumers:14,unprovenConsumers:1097,directPassConsumers:14,equivalentPassConsumers:0,verdicts:{STATIC_ONLY:545,BLOCKED_DYNAMIC:552,BLOCKED_REGISTRY_MISMATCH:0,PARTIAL:0,DIRECT_PASS:14,EQUIVALENT_PASS:0},registrySourceMismatchCount:8});
    assert.equal(receipts.receipts.length,70);
    for(const consumerId of consumerIds){const source=manifest.consumers.find((candidate:any)=>candidate.consumerId===consumerId);assert.equal(receipts.receipts.filter((receipt:any)=>receipt.consumerId===consumerId).length,5);assert.equal(ledger.entries.find((entry:any)=>entry.consumerId===consumerId)?.verdict,"DIRECT_PASS");assert.doesNotThrow(()=>assertTrustedWave7ConsumerFixtureMapping(consumerId,consumerFor(consumerId),source));}
  });

  it("executes exact ordered queries and read-only traces in fresh child processes",()=>{
    for(const binding of fixture.bindings){const run=runBinding(binding);try{assert.equal(run.error,null);const caseResult=JSON.parse(readFileSync(join(run.outputDirectory,"case-result.json"),"utf8")),trace=JSON.parse(readFileSync(join(run.outputDirectory,"trace.json"),"utf8")),consumer=consumerFor(binding.consumerId),scenarioRows=consumer.queryRowsByScenario[binding.scenarioKind]??[],repetitions=binding.scenarioKind==="RESTART_CONSISTENCY"?2:1,expectedTrace=Array.from({length:repetitions},()=>scenarioRows.map((rows:any[],index:number)=>({channel:"query",normalizedSql:consumer.orderedQueries[index].expectedNormalizedSql,values:consumer.orderedQueries[index].expectedQueryValues,rowCount:rows.length}))).flat();assert.equal(caseResult.passed,true);assert.deepEqual(trace.queryTrace,expectedTrace);assert.deepEqual(trace.normalizedStatements,[]);assert.equal(trace.rowCount,0);assert.deepEqual(trace.lockOrder,[]);assert.equal(trace.transaction,"READ_ONLY");if(binding.scenarioKind==="NEGATIVE_GUARD")assert.deepEqual(trace.timeline,["GUARD_REJECTED"]);if(binding.scenarioKind==="RESTART_CONSISTENCY"){const result=JSON.parse(readFileSync(join(run.outputDirectory,"result.raw"),"utf8"));assert.deepEqual(result.restartEvidence,{processExecutions:2,distinctProcessIds:true,distinctModuleExecutions:true});}}finally{rmSync(run.outputDirectory,{recursive:true,force:true});}}
  });

  it("fails closed on dispatch, chain, invocation, query, row and result drift",()=>{
    for(const consumerId of consumerIds){const original=consumerFor(consumerId),source=manifest.consumers.find((candidate:any)=>candidate.consumerId===consumerId);for(const mutate of[(value:any)=>{value.sourceLocator.symbol="other";},(value:any)=>{value.frozenSourceCommit="0".repeat(40);},(value:any)=>{value.currentDispatchLocator.sha256="0".repeat(64);},(value:any)=>{value.chainLocators[0].needle="missing";},(value:any)=>{value.input.message="/변조";},(value:any)=>{value.orderedQueries.reverse();},(value:any)=>{value.queryRowsByScenario.READ_POSITIVE[0]=[];},(value:any)=>{value.expectedResultsByScenario.READ_POSITIVE.message="변조";}]){const changed=structuredClone(original);mutate(changed);assert.throws(()=>assertTrustedWave7ConsumerFixtureMapping(consumerId,changed,source),/drift/);}}
    for(const consumerId of consumerIds){const payload=structuredClone(fixture.payload),changed=payload.cases.flatMap((parityCase:any)=>parityCase.consumers).find((consumer:any)=>consumer.consumerId===consumerId);changed.orderedQueries.reverse();const binding=fixture.bindings.find((candidate:any)=>candidate.consumerId===consumerId&&candidate.scenarioKind==="READ_POSITIVE"),run=runBinding(binding,payload);try{assert.ok(run.error);const stderr=(run.error as{stderr?:Buffer}).stderr?.toString("utf8")??String(run.error);assert.match(stderr,/ordered SELECT (SQL|count) drift/);}finally{rmSync(run.outputDirectory,{recursive:true,force:true});}}
  });
});
