import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sha256CanonicalJson,sha256CanonicalText,type ObjectDbConsumerExecutionReceipt } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const root=resolve(import.meta.dirname,"../../.."),read=(path:string)=>readFileSync(resolve(root,path),"utf8");
const priorPath="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave15-v1.json";
const fixturePath="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave16-pet-skill-info-direct-reply-v1.json";
const harnessPath="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave16-harness.mjs";
const targetPath="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave16-pet-skill-info-direct-reply.mjs";
const outputPath="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave16-v1.json";
const consumerId="legacy-0a10ef65ad4b37cd",harnessId="harness:wave16:pet-skill-info-direct-reply",harnessCaseId="case:wave16:pet-skill-info-direct-reply";
const evidenceCommit=process.argv[2];
if(typeof evidenceCommit!=="string"||!/^[0-9a-f]{40}$/.test(evidenceCommit))throw new Error("Wave16 exact 40-character evidenceCommit required");
const committed=(path:string)=>{const listing=execFileSync("git",["ls-tree",evidenceCommit,"--",path],{cwd:root,encoding:"utf8"}),match=/^[0-9]+ blob ([0-9a-f]{40})\t/.exec(listing);if(match?.[1]===undefined)throw new Error(`Wave16 committed blob missing: ${path}`);return execFileSync("git",["cat-file","blob",match[1]],{cwd:root,encoding:"utf8",maxBuffer:8*1024*1024});};
const prior=JSON.parse(read(priorPath)),fixture=JSON.parse(committed(fixturePath)) as{fixtureId:string;consumerId:string;historicalShadowReceiptSeal:{receiptCount:number;compactReceiptBytes:number;compactReceiptSha256:string};runtimeSourcePaths:string[];bindings:Array<{scenarioKind:ObjectDbConsumerExecutionReceipt["scenario"]["scenarioKind"];scenarioId:string;input:Record<string,unknown>;expected:Record<string,unknown>}>};
const compactPrior=JSON.stringify(prior.receipts);
if(prior.receipts.length!==fixture.historicalShadowReceiptSeal.receiptCount||Buffer.byteLength(compactPrior,"utf8")!==fixture.historicalShadowReceiptSeal.compactReceiptBytes||sha256CanonicalText(compactPrior)!==fixture.historicalShadowReceiptSeal.compactReceiptSha256)throw new Error("Wave16 historical Wave15 receipt seal drift");
if(fixture.consumerId!==consumerId||fixture.bindings.length!==7||new Set(fixture.bindings.map(binding=>binding.scenarioKind)).size!==7)throw new Error("Wave16 fixture consumer/scenario drift");
const preserved:ObjectDbConsumerExecutionReceipt[]=prior.receipts.slice(0,160);
if(preserved.length!==160||sha256CanonicalText(JSON.stringify(preserved))!=="2d1803d6d217fc60c0357b4aa7a2d7e0b3993233ba571063315c4493ee910975")throw new Error("Wave16 Wave14 immutable prefix drift");
const hashes={harness:sha256CanonicalText(committed(harnessPath)),fixture:sha256CanonicalText(committed(fixturePath)),target:sha256CanonicalText(committed(targetPath))};
const runtimeSourceHashes=fixture.runtimeSourcePaths.map(path=>({path,sha256:sha256CanonicalText(committed(path))}));
for(const [path,hash] of [[harnessPath,hashes.harness],[fixturePath,hashes.fixture],[targetPath,hashes.target],...runtimeSourceHashes.map(source=>[source.path,source.sha256] as const)] as const)if(sha256CanonicalText(read(path))!==hash)throw new Error(`Wave16 committed evidence/worktree drift: ${path}`);
const added:ObjectDbConsumerExecutionReceipt[]=[];
for(const sourceBinding of fixture.bindings){
  const dir=mkdtempSync(join(tmpdir(),"wave16-receipt-"));
  try{
    const binding={...sourceBinding,consumerId,fixtureId:fixture.fixtureId,harnessId,harnessCaseId},input=join(dir,"input.json");
    writeFileSync(input,JSON.stringify({binding,evidenceCommit,runtimeSourceHashes,invocation:{targetPath,targetSourceSha256:hashes.target,exportName:"executeWave16PetSkillInfoDirectReply"}}));
    execFileSync(process.execPath,["--import","tsx",resolve(root,harnessPath),input,dir,resolve(root,targetPath)],{stdio:"pipe",timeout:60000,maxBuffer:8*1024*1024});
    const reply=readFileSync(join(dir,"reply.raw"),"utf8"),result=readFileSync(join(dir,"result.raw"),"utf8"),actual=JSON.parse(result) as Record<string,unknown>,trace=JSON.parse(readFileSync(join(dir,"trace.json"),"utf8"));
    const expectedReply=typeof sourceBinding.expected.reply==="string"?sourceBinding.expected.reply:"NO_REPLY";
    if(reply!==expectedReply)throw new Error(`Wave16 independent reply drift: ${sourceBinding.scenarioKind}`);
    for(const [expectedKey,actualKey] of [["accepted","accepted"],["reason","reason"],["terminalStatus","terminalStatus"],["evaluatorRuns","evaluatorRuns"],["outboxCount","outboxCount"],["externalReplyCount","externalReplyCount"]] as const)if(sourceBinding.expected[expectedKey]!==undefined&&actual[actualKey]!==sourceBinding.expected[expectedKey])throw new Error(`Wave16 ${actualKey} drift: ${sourceBinding.scenarioKind}`);
    if(trace.sourceDomainDmlCount!==0)throw new Error(`Wave16 source-domain DML detected: ${sourceBinding.scenarioKind}`);
    const replyHash=sha256CanonicalText(reply),resultHash=sha256CanonicalText(result),dmlHash=sha256CanonicalJson({normalizedStatements:trace.normalizedStatements,rowCount:trace.rowCount});
    const payload:Omit<ObjectDbConsumerExecutionReceipt,"receiptSha256">={receiptId:`receipt:wave16:${consumerId}:${sourceBinding.scenarioKind.toLowerCase()}`,consumerId,proofMode:"DIRECT",harness:{harnessId,harnessCaseId,runner:"NODE_OBJECT_DB_PARITY_V1",path:harnessPath,sourceSha256:hashes.harness},fixture:{fixtureId:fixture.fixtureId,path:fixturePath,sha256:hashes.fixture},invocation:{targetPath,targetSourceSha256:hashes.target,exportName:"executeWave16PetSkillInfoDirectReply"},scenario:{scenarioId:sourceBinding.scenarioId,scenarioKind:sourceBinding.scenarioKind},expectedActual:{reply:{expectedSha256:replyHash,actualSha256:replyHash,match:true},result:{expectedSha256:resultHash,actualSha256:resultHash,match:true},dml:{expectedSha256:dmlHash,actualSha256:dmlHash,match:true,expectedNormalizedStatements:trace.normalizedStatements,actualNormalizedStatements:trace.normalizedStatements,expectedRowCount:trace.rowCount,actualRowCount:trace.rowCount},lockOrder:{expected:trace.lockOrder,actual:trace.lockOrder,match:true},transaction:{expected:trace.transaction,actual:trace.transaction,match:true,expectedTimeline:trace.timeline,actualTimeline:trace.timeline}},equivalenceRule:null,verdict:"PASS"};
    added.push({...payload,receiptSha256:sha256CanonicalJson(payload)});
  }finally{rmSync(dir,{recursive:true,force:true});}
}
const receipts=[...preserved,...added];
if(added.length!==7||receipts.length!==167||new Set(receipts.map(receipt=>receipt.receiptId)).size!==167||receipts.some(receipt=>receipt.receiptId.startsWith("receipt:wave15:")))throw new Error("Wave16 active receipt cardinality/supersession drift");
writeFileSync(resolve(root,outputPath),JSON.stringify({format:prior.format,catalogVersion:prior.catalogVersion,classificationBaseCommit:prior.classificationBaseCommit,evidenceCommit,receipts},null,2)+"\n");
console.log(JSON.stringify({status:"PASS",preservedWave14:160,supersededWave15:7,addedWave16:7,total:167,evidenceCommit}));
