import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe,it } from "node:test";
import { assertTrustedWave7ConsumerFixtureMapping,parseObjectDbConsumerExecutionReceiptBundle } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const runtimeRoot=resolve(import.meta.dirname,".."),repoRoot=resolve(runtimeRoot,"../.."),read=(path:string)=>readFileSync(resolve(repoRoot,path),"utf8"),json=(path:string)=>JSON.parse(read(path));
const wave7=json("개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave7-service-chain-v1.json");
const manifest=json("개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json");
const wave15=json("개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave15-v1.json");
const fixturePath="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave16-pet-skill-info-direct-reply-v1.json",fixture=json(fixturePath);
const harnessPath=resolve(repoRoot,"개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave16-harness.mjs"),targetPath=resolve(repoRoot,"개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave16-pet-skill-info-direct-reply.mjs");
const hash=(value:string)=>createHash("sha256").update(value.replace(/\r\n?/g,"\n"),"utf8").digest("hex");

describe("object DB executable parity Wave16 direct reply",()=>{
  it("keeps the trusted Wave7 fixture immutable while allowing current source offset relocation",()=>{
    const id="runtime-dispatch-f53934feccdd6d39",frozen=wave7.payload.cases.flatMap((value:any)=>value.consumers).find((value:any)=>value.consumerId===id),current=manifest.consumers.find((value:any)=>value.consumerId===id);
    assert.notEqual(frozen.sourceLocator.start,current.sourceSpan.start);assert.equal(frozen.sourceLocator.sha256,current.sourceSpan.sha256);
    assert.doesNotThrow(()=>assertTrustedWave7ConsumerFixtureMapping(id,frozen,current));
    const moved={...current,sourceSpan:{...current.sourceSpan,start:current.sourceSpan.start+123,end:current.sourceSpan.end+123}};
    assert.doesNotThrow(()=>assertTrustedWave7ConsumerFixtureMapping(id,frozen,moved));
    assert.throws(()=>assertTrustedWave7ConsumerFixtureMapping(id,frozen,{...current,sourceSpan:{...current.sourceSpan,sha256:"0".repeat(64)}}),/drift/);
    const tampered=structuredClone(frozen);tampered.expectedResultsByScenario.READ_POSITIVE.message+="변조";
    assert.throws(()=>assertTrustedWave7ConsumerFixtureMapping(id,tampered,current),/drift/);
  });

  it("preserves Wave15 as a sealed historical artifact and activates exactly seven replacing Wave16 scenarios",()=>{
    const compact=JSON.stringify(wave15.receipts);assert.equal(wave15.receipts.length,167);assert.equal(Buffer.byteLength(compact,"utf8"),800975);assert.equal(hash(compact),"13f737ec01a5f0ace33efc2d4243baef1880d21fb5ac21f47f8bbe60fc2c44f5");
    const wave16=fixture.bindings.map((binding:any)=>({receiptId:`receipt:wave16:legacy-0a10ef65ad4b37cd:${binding.scenarioKind.toLowerCase()}`}));
    const active={format:wave15.format,catalogVersion:wave15.catalogVersion,classificationBaseCommit:wave15.classificationBaseCommit,evidenceCommit:"f".repeat(40),receipts:[...wave15.receipts.slice(0,160),...wave16]};
    assert.doesNotThrow(()=>parseObjectDbConsumerExecutionReceiptBundle(active));
    assert.throws(()=>parseObjectDbConsumerExecutionReceiptBundle({...active,receipts:[...active.receipts,...wave15.receipts.slice(160)]}),/(cannot be active together|cardinality drift)/);
    assert.deepEqual(new Set(fixture.bindings.map((binding:any)=>binding.scenarioKind)),new Set(["READ_POSITIVE","NEGATIVE_GUARD","AUTH_DENIED","WRONG_ROOM_REJECTED","EXACT_OUTPUT","SOURCE_DOMAIN_DML_ZERO","RESTART_CONSISTENCY"]));
  });

  it("executes every Wave16 binding without external reply or source-domain DML",()=>{
    for(const sourceBinding of fixture.bindings){
      const dir=mkdtempSync(join(tmpdir(),"wave16-focused-"));
      try{
        const binding={...sourceBinding,consumerId:fixture.consumerId,fixtureId:fixture.fixtureId,harnessId:"harness:wave16:pet-skill-info-direct-reply",harnessCaseId:"case:wave16:pet-skill-info-direct-reply"},input=join(dir,"input.json");
        writeFileSync(input,JSON.stringify({binding,invocation:{targetPath:"개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave16-pet-skill-info-direct-reply.mjs",targetSourceSha256:hash(readFileSync(targetPath,"utf8")),exportName:"executeWave16PetSkillInfoDirectReply"}}));
        execFileSync(process.execPath,["--import","tsx",harnessPath,input,dir,targetPath],{stdio:"pipe",timeout:60000,maxBuffer:8*1024*1024});
        const result=JSON.parse(readFileSync(join(dir,"result.raw"),"utf8")),trace=JSON.parse(readFileSync(join(dir,"trace.json"),"utf8"));
        assert.equal(result.externalReplyCount,0,sourceBinding.scenarioKind);assert.equal(trace.sourceDomainDmlCount,0,sourceBinding.scenarioKind);
        if(sourceBinding.expected.reply!==undefined)assert.equal(readFileSync(join(dir,"reply.raw"),"utf8"),sourceBinding.expected.reply);
      }finally{rmSync(dir,{recursive:true,force:true});}
    }
  });

  it("requires a committed evidence SHA and never writes a Wave16 bundle during ordinary validation",()=>{
    const generator=read("개발환경_고도화/runtime/scripts/generate-object-db-consumer-executable-parity-wave16.ts");
    assert.match(generator,/Wave16 exact 40-character evidenceCommit required/);assert.match(generator,/prior\.receipts\.slice\(0,160\)/);assert.match(generator,/receipt:wave16:/);assert.doesNotMatch(generator,/generate-object-db-consumer-executable-parity-wave(?:[1-9]|1[0-5])\.ts/);
  });
});
