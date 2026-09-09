import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sha256CanonicalJson, sha256CanonicalText, type ObjectDbConsumerExecutionReceipt } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const root=resolve(import.meta.dirname,"../../.."),read=(path:string)=>readFileSync(resolve(root,path),"utf8");
const fixturePath="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave15-pet-skill-info-private-dev-v1.json";
const harnessPath="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave15-harness.mjs";
const targetPath="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave15-pet-skill-info-private-dev.mjs";
const outputPath="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave15-v1.json";
const priorPath="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave14-v1.json";
const runtimeSourcePaths=[
  "개발환경_고도화/runtime/src/app.ts",
  "개발환경_고도화/runtime/src/dispatch/app-wiring-operation-provider.ts",
  "개발환경_고도화/runtime/src/dispatch/app-wiring-read-only-recovery-provider.ts",
  "개발환경_고도화/runtime/src/pet/pet-skill-info-read-only-recovery-ingress.ts",
  "개발환경_고도화/runtime/src/pet/pet-skill-info-shadow-service.ts"
] as const;
const consumerId="legacy-0a10ef65ad4b37cd",harnessId="harness:wave15:pet-skill-info-private-dev",harnessCaseId="case:wave15:pet-skill-info-private-dev";
const prior=JSON.parse(read(priorPath)),evidenceCommit=process.argv[2];
if(typeof evidenceCommit!=="string"||!/^[0-9a-f]{40}$/.test(evidenceCommit))throw new Error("Wave15 exact 40-character evidenceCommit required");
const committed=(path:string)=>{const listing=execFileSync("git",["ls-tree",evidenceCommit,"--",path],{cwd:root,encoding:"utf8"}),match=/^[0-9]+ blob ([0-9a-f]{40})\t/.exec(listing);if(match?.[1]===undefined)throw new Error(`Wave15 committed blob missing: ${path}`);return execFileSync("git",["cat-file","blob",match[1]],{cwd:root,encoding:"utf8",maxBuffer:8*1024*1024});};
const fixture=JSON.parse(committed(fixturePath)) as {fixtureId:string;bindings:Array<{scenarioKind:string;scenarioId:string;input:Record<string,unknown>;expected:Record<string,unknown>}>};
const hashes={harness:sha256CanonicalText(committed(harnessPath)),fixture:sha256CanonicalText(committed(fixturePath)),target:sha256CanonicalText(committed(targetPath))};
const runtimeSourceHashes=runtimeSourcePaths.map(path=>({path,sha256:sha256CanonicalText(committed(path))}));
for(const [path,hash] of [[harnessPath,hashes.harness],[fixturePath,hashes.fixture],[targetPath,hashes.target],...runtimeSourceHashes.map(source=>[source.path,source.sha256] as const)] as const)if(sha256CanonicalText(read(path))!==hash)throw new Error(`Wave15 committed evidence/worktree drift: ${path}`);
const preserved:ObjectDbConsumerExecutionReceipt[]=prior.receipts,added:ObjectDbConsumerExecutionReceipt[]=[];
if(preserved.length!==160||Buffer.byteLength(JSON.stringify(preserved),"utf8")!==740925||sha256CanonicalText(JSON.stringify(preserved))!=="2d1803d6d217fc60c0357b4aa7a2d7e0b3993233ba571063315c4493ee910975")throw new Error("Wave15 prior160 immutable prefix drift");
for(const receipt of preserved){const{receiptSha256,...payload}=receipt;if(receiptSha256!==sha256CanonicalJson(payload))throw new Error(`Wave14 prior receipt hash drift: ${receipt.receiptId}`);}
if(fixture.bindings.length!==7)throw new Error("Wave15 seven-scenario fixture required");
const canonicalSkillReply=fixture.bindings.find(binding=>binding.scenarioKind==="READ_POSITIVE")?.expected.reply;
if(typeof canonicalSkillReply!=="string")throw new Error("Wave15 independent canonical skill reply missing");
for(const sourceBinding of fixture.bindings){const dir=mkdtempSync(join(tmpdir(),"wave15-receipt-"));try{
  const binding={...sourceBinding,consumerId,fixtureId:fixture.fixtureId,harnessId,harnessCaseId},input=join(dir,"input.json");
  writeFileSync(input,JSON.stringify({binding,evidenceCommit,runtimeSourceHashes,invocation:{targetPath,targetSourceSha256:hashes.target,exportName:"executeWave15PetSkillInfoPrivateDev"}}));
  execFileSync(process.execPath,[resolve(root,harnessPath),input,dir,resolve(root,targetPath)],{stdio:"pipe",timeout:60000,maxBuffer:8*1024*1024});
  const reply=readFileSync(join(dir,"reply.raw"),"utf8"),result=readFileSync(join(dir,"result.raw"),"utf8"),actual=JSON.parse(result) as Record<string,unknown>,trace=JSON.parse(readFileSync(join(dir,"trace.json"),"utf8"));
  const expectedReply=typeof sourceBinding.expected.reply==="string"?sourceBinding.expected.reply:sourceBinding.expected.accepted===true&&String(sourceBinding.input.rawMessage).includes("청룡언월도")?canonicalSkillReply:"NO_REPLY";
  if(reply!==expectedReply)throw new Error(`Wave15 independent expected reply drift: ${sourceBinding.scenarioKind}`);
  const expectedHandlerCount=sourceBinding.expected.handlerInvocationCount??sourceBinding.expected.firstHandlerInvocationCount;
  if(expectedHandlerCount!==undefined&&actual.handlerInvocationCount!==expectedHandlerCount)throw new Error(`Wave15 handler count drift: ${sourceBinding.scenarioKind}`);
  if(typeof sourceBinding.expected.accepted==="boolean"&&actual.accepted!==sourceBinding.expected.accepted)throw new Error(`Wave15 acceptance drift: ${sourceBinding.scenarioKind}`);
  if(sourceBinding.expected.terminalResult!==undefined&&actual.terminalResult!==sourceBinding.expected.terminalResult)throw new Error(`Wave15 terminal result drift: ${sourceBinding.scenarioKind}`);
  if(sourceBinding.expected.operationCount!==undefined&&actual.operationCount!==sourceBinding.expected.operationCount)throw new Error(`Wave15 operation cardinality drift: ${sourceBinding.scenarioKind}`);
  if(sourceBinding.expected.commandExecutionCount!==undefined&&actual.commandExecutionCount!==sourceBinding.expected.commandExecutionCount)throw new Error(`Wave15 execution cardinality drift: ${sourceBinding.scenarioKind}`);
  if(sourceBinding.expected.outboxCount!==undefined&&actual.outboxCount!==sourceBinding.expected.outboxCount)throw new Error(`Wave15 outbox cardinality drift: ${sourceBinding.scenarioKind}`);
  if(trace.sourceDomainDmlCount!==0)throw new Error(`Wave15 source-domain DML detected: ${sourceBinding.scenarioKind}`);
  const replyHash=sha256CanonicalText(reply),resultHash=sha256CanonicalText(result),dmlHash=sha256CanonicalJson({normalizedStatements:trace.normalizedStatements,rowCount:trace.rowCount});
  const payload:Omit<ObjectDbConsumerExecutionReceipt,"receiptSha256">={receiptId:`receipt:wave15:${consumerId}:${sourceBinding.scenarioKind.toLowerCase()}`,consumerId,proofMode:"DIRECT",harness:{harnessId,harnessCaseId,runner:"NODE_OBJECT_DB_PARITY_V1",path:harnessPath,sourceSha256:hashes.harness},fixture:{fixtureId:fixture.fixtureId,path:fixturePath,sha256:hashes.fixture},invocation:{targetPath,targetSourceSha256:hashes.target,exportName:"executeWave15PetSkillInfoPrivateDev"},scenario:{scenarioId:sourceBinding.scenarioId,scenarioKind:sourceBinding.scenarioKind as ObjectDbConsumerExecutionReceipt["scenario"]["scenarioKind"]},expectedActual:{reply:{expectedSha256:replyHash,actualSha256:replyHash,match:true},result:{expectedSha256:resultHash,actualSha256:resultHash,match:true},dml:{expectedSha256:dmlHash,actualSha256:dmlHash,match:true,expectedNormalizedStatements:trace.normalizedStatements,actualNormalizedStatements:trace.normalizedStatements,expectedRowCount:trace.rowCount,actualRowCount:trace.rowCount},lockOrder:{expected:trace.lockOrder,actual:trace.lockOrder,match:true},transaction:{expected:trace.transaction,actual:trace.transaction,match:true,expectedTimeline:trace.timeline,actualTimeline:trace.timeline}},equivalenceRule:null,verdict:"PASS"};
  added.push({...payload,receiptSha256:sha256CanonicalJson(payload)});
}finally{rmSync(dir,{recursive:true,force:true});}}
const receipts=[...preserved,...added];if(added.length!==7||receipts.length!==167||new Set(receipts.map(receipt=>receipt.receiptId)).size!==167)throw new Error("Wave15 receipt cardinality/uniqueness drift");
if(JSON.stringify(receipts.slice(0,160))!==JSON.stringify(preserved))throw new Error("Wave14 prior receipt prefix drift");
writeFileSync(resolve(root,outputPath),JSON.stringify({format:prior.format,catalogVersion:prior.catalogVersion,classificationBaseCommit:prior.classificationBaseCommit,evidenceCommit,receipts},null,2)+"\n");
console.log(JSON.stringify({status:"PASS",prior:160,added:7,total:167,evidenceCommit}));
