import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe,it } from "node:test";

import { parseObjectDbConsumerExecutionReceiptBundle } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const runtimeRoot=resolve(import.meta.dirname,".."),repoRoot=resolve(runtimeRoot,"../.."),read=(path:string)=>readFileSync(resolve(repoRoot,path),"utf8");
const fixturePath="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave17-item-bag-read-providers-v1.json",fixture=JSON.parse(read(fixturePath));
const harnessPath=resolve(repoRoot,"개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave17-item-bag-read-providers-harness.mjs"),targetPath=resolve(repoRoot,"개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave17-item-bag-read-providers.mjs");
const targetRelative="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave17-item-bag-read-providers.mjs",hash=(value:string)=>createHash("sha256").update(value.replace(/\r\n?/g,"\n"),"utf8").digest("hex");
const wave16=JSON.parse(read("개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave16-v1.json"));

describe("object DB executable parity Wave17 item-bag read providers",()=>{
  it("freezes exactly five direct READ scenarios per WBS776 SQL consumer",()=>{
    const required=new Set(["READ_POSITIVE","NEGATIVE_GUARD","EXACT_OUTPUT","SOURCE_DOMAIN_DML_ZERO","RESTART_CONSISTENCY"]);
    assert.deepEqual(fixture.consumerIds,["sql-repository-19f17500144188bf","sql-repository-2415b4267e1577c6"]);assert.equal(fixture.bindings.length,10);
    for(const consumerId of fixture.consumerIds)assert.deepEqual(new Set(fixture.bindings.filter((binding:any)=>binding.consumerId===consumerId).map((binding:any)=>binding.scenarioKind)),required);
    assert.equal(fixture.receiptContract.transaction,"READ_ONLY");assert.equal(fixture.receiptContract.sourceDomainDmlCount,0);assert.equal(fixture.receiptContract.restart,"DISTINCT_NODE_CHILD_PROCESSES");
    const appended=fixture.bindings.map((binding:any)=>({receiptId:`receipt:wave17:${binding.consumerId}:${binding.scenarioKind.toLowerCase()}`})),bundle={...wave16,evidenceCommit:"f".repeat(40),receipts:[...wave16.receipts,...appended]};assert.doesNotThrow(()=>parseObjectDbConsumerExecutionReceiptBundle(bundle));assert.throws(()=>parseObjectDbConsumerExecutionReceiptBundle({...bundle,receipts:bundle.receipts.slice(1)}),/(cardinality|fingerprint) drift/);
  });

  it("imports and calls both actual providers with exact output, READ_ONLY/DML0, and child-process restart",()=>{
    for(const sourceBinding of fixture.bindings){const dir=mkdtempSync(join(tmpdir(),"wave17-item-bag-focused-"));try{const harnessCaseId=sourceBinding.consumerId==="sql-repository-19f17500144188bf"?"case:wave17:legacy-bag-owner-label":"case:wave17:canonical-item-bag-import-readiness",binding={...sourceBinding,fixtureId:fixture.fixtureId,harnessId:"harness:wave17:item-bag-read-providers",harnessCaseId},input=join(dir,"input.json"),invocation={targetPath:targetRelative,targetSourceSha256:hash(readFileSync(targetPath,"utf8")),exportName:sourceBinding.exportName};writeFileSync(input,JSON.stringify({binding,invocation}));execFileSync(process.execPath,["--import","tsx",harnessPath,input,dir,targetPath],{stdio:"pipe",timeout:60000,maxBuffer:8*1024*1024});const result=JSON.parse(readFileSync(join(dir,"result.raw"),"utf8")),trace=JSON.parse(readFileSync(join(dir,"trace.json"),"utf8"));assert.deepEqual(result,sourceBinding.expectedResult,sourceBinding.scenarioKind);assert.equal(readFileSync(join(dir,"reply.raw"),"utf8"),"NO_REPLY");assert.equal(trace.transaction,"READ_ONLY");assert.equal(trace.sourceDomainDmlCount,0);assert.deepEqual(trace.normalizedStatements,[]);assert.equal(trace.rowCount,0);assert.ok(trace.queryTrace.length>0||sourceBinding.scenarioKind==="NEGATIVE_GUARD");if(sourceBinding.scenarioKind==="RESTART_CONSISTENCY")assert.equal(new Set(trace.restartProcessIds).size,2);}finally{rmSync(dir,{recursive:true,force:true});}}
  });

  it("rejects target tampering and requires a committed evidence SHA for generation",()=>{
    const dir=mkdtempSync(join(tmpdir(),"wave17-item-bag-tamper-"));try{const sourceBinding=fixture.bindings[0],binding={...sourceBinding,fixtureId:fixture.fixtureId,harnessId:"harness:wave17:item-bag-read-providers",harnessCaseId:"case:wave17:legacy-bag-owner-label"},input=join(dir,"input.json"),invocation={targetPath:targetRelative,targetSourceSha256:"0".repeat(64),exportName:sourceBinding.exportName};writeFileSync(input,JSON.stringify({binding,invocation}));assert.throws(()=>execFileSync(process.execPath,["--import","tsx",harnessPath,input,dir,targetPath],{stdio:"pipe",timeout:60000}),/Command failed/);}finally{rmSync(dir,{recursive:true,force:true});}
    const generator=read("개발환경_고도화/runtime/scripts/generate-object-db-consumer-executable-parity-wave17-item-bag-read-providers.ts");assert.match(generator,/Wave17 exact 40-character evidenceCommit required/);assert.match(generator,/\.\.\.prior\.receipts,\.\.\.added/);assert.match(generator,/receipts\.length!==177/);assert.doesNotMatch(generator,/wave6-multi-query|receipt:wave6:/);
  });
});
