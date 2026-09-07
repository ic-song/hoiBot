import assert from"node:assert/strict";
import{execFileSync}from"node:child_process";
import{createHash}from"node:crypto";
import{mkdtempSync,readFileSync,rmSync,writeFileSync}from"node:fs";
import{join,resolve}from"node:path";
import{describe,it}from"node:test";

const runtimeRoot=resolve(import.meta.dirname,".."),repoRoot=resolve(runtimeRoot,"../.."),
  harness=resolve(runtimeRoot,"test/fixtures/object-db-executable-parity-wave15-harness.mjs"),
  target=resolve(runtimeRoot,"test/fixtures/object-db-executable-parity-wave15-pet-skill-info-private-dev.mjs"),
  fixturePath=resolve(repoRoot,"개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave15-pet-skill-info-private-dev-v1.json"),
  fixture=JSON.parse(readFileSync(fixturePath,"utf8"))as{fixtureId:string;bindings:Array<Record<string,unknown>>},
  sha=(path:string)=>createHash("sha256").update(readFileSync(path,"utf8").replace(/\r\n?/g,"\n")).digest("hex");
function binding(value:Record<string,unknown>){return{...value,consumerId:"legacy-0a10ef65ad4b37cd",fixtureId:fixture.fixtureId,harnessId:"harness:wave15:pet-skill-info-private-dev",harnessCaseId:"case:wave15:pet-skill-info-private-dev"};}
function run(value:Record<string,unknown>){const dir=mkdtempSync(join(process.env.TEMP??runtimeRoot,"hoi-wave15-")),input=join(dir,"input.json");writeFileSync(input,JSON.stringify({binding:binding(value),invocation:{targetPath:"개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave15-pet-skill-info-private-dev.mjs",targetSourceSha256:sha(target),exportName:"executeWave15PetSkillInfoPrivateDev"}}));let error:unknown;try{execFileSync(process.execPath,[harness,input,dir,target],{stdio:"pipe",timeout:60000,maxBuffer:8*1024*1024});}catch(value){error=value;}return{dir,error,trace:()=>JSON.parse(readFileSync(join(dir,"trace.json"),"utf8")),result:()=>JSON.parse(readFileSync(join(dir,"result.raw"),"utf8"))};}

describe("Wave15 /펫스킬정보 private/dev actual ingress",()=>{
  it("executes the frozen seven-scenario matrix through buildApp.inject and common recovery",()=>{assert.equal(fixture.bindings.length,7);for(const value of fixture.bindings){const scenario=String(value.scenarioKind),out=run(value);try{assert.equal(out.error,undefined,`${scenario}: ${String((out.error as{stderr?:Buffer})?.stderr??"")}`);const trace=out.trace();assert.equal(trace.sourceDomainDmlCount,0,scenario);assert.ok(Array.isArray(trace.timeline),scenario);if(scenario==="RESTART_CONSISTENCY"){assert.equal(out.result().operationCount,1);assert.equal(out.result().commandExecutionCount,1);}}finally{rmSync(out.dir,{recursive:true,force:true});}}});
  it("fails closed when a frozen expected reply is changed",()=>{const source=fixture.bindings.find(value=>value.scenarioKind==="READ_POSITIVE")!;const changed=structuredClone(source)as{expected:{reply:string}};changed.expected.reply+="변조";const out=run(changed as unknown as Record<string,unknown>);try{assert.notEqual(out.error,undefined);assert.match(String((out.error as{stderr?:Buffer})?.stderr),/independent expected reply drift/);}finally{rmSync(out.dir,{recursive:true,force:true});}});
});
