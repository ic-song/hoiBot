import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { sha256CanonicalJson,sha256CanonicalText,type ObjectDbConsumerExecutionReceipt } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const root=resolve(import.meta.dirname,"../../.."),read=(path:string)=>readFileSync(resolve(root,path),"utf8");
const priorPath="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave16-v1.json";
const fixturePath="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave17-item-bag-read-providers-v1.json";
const harnessPath="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave17-item-bag-read-providers-harness.mjs";
const targetPath="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave17-item-bag-read-providers.mjs";
const outputPath="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave17-v1.json";
const consumerIds=new Set(["sql-repository-19f17500144188bf","sql-repository-2415b4267e1577c6"]),harnessId="harness:wave17:item-bag-read-providers";
const evidenceCommit=process.argv[2];
if(typeof evidenceCommit!=="string"||!/^[0-9a-f]{40}$/.test(evidenceCommit))throw new Error("Wave17 exact 40-character evidenceCommit required");
const committed=(path:string)=>{const listing=execFileSync("git",["ls-tree",evidenceCommit,"--",path],{cwd:root,encoding:"utf8"}),match=/^[0-9]+ blob ([0-9a-f]{40})\t/.exec(listing);if(match?.[1]===undefined)throw new Error(`Wave17 committed blob missing: ${path}`);return execFileSync("git",["cat-file","blob",match[1]],{cwd:root,encoding:"utf8",maxBuffer:8*1024*1024});};
type Binding={consumerId:string;scenarioId:string;scenarioKind:ObjectDbConsumerExecutionReceipt["scenario"]["scenarioKind"];exportName:string;expectedResult:unknown};
const prior=JSON.parse(read(priorPath)),fixture=JSON.parse(committed(fixturePath)) as{fixtureId:string;consumerIds:string[];runtimeSourcePaths:string[];bindings:Binding[]};
const compactPrior=JSON.stringify(prior.receipts);
if(prior.receipts.length!==167||Buffer.byteLength(compactPrior,"utf8")!==762133||sha256CanonicalText(compactPrior)!=="64f80cf0f01beff713905ba414db4c11f1f192e6eab8136127047d3d2444015f")throw new Error("Wave17 immutable Wave16 receipt prefix drift");
if(fixture.bindings.length!==10||new Set(fixture.bindings.map(binding=>`${binding.consumerId}:${binding.scenarioKind}`)).size!==10||fixture.consumerIds.some(id=>!consumerIds.has(id)))throw new Error("Wave17 fixture consumer/scenario drift");
const hashes={harness:sha256CanonicalText(committed(harnessPath)),fixture:sha256CanonicalText(committed(fixturePath)),target:sha256CanonicalText(committed(targetPath))};
const runtimeSourceHashes=fixture.runtimeSourcePaths.map(path=>({path,sha256:sha256CanonicalText(committed(path))}));
for(const [path,hash] of [[harnessPath,hashes.harness],[fixturePath,hashes.fixture],[targetPath,hashes.target],...runtimeSourceHashes.map(source=>[source.path,source.sha256] as const)] as const)if(sha256CanonicalText(read(path))!==hash)throw new Error(`Wave17 committed evidence/worktree drift: ${path}`);
const added:ObjectDbConsumerExecutionReceipt[]=[];
for(const sourceBinding of fixture.bindings){
  const dir=mkdtempSync(join(tmpdir(),"wave17-item-bag-receipt-"));
  try{
    const harnessCaseId=sourceBinding.consumerId==="sql-repository-19f17500144188bf"?"case:wave17:legacy-bag-owner-label":"case:wave17:canonical-item-bag-import-readiness";
    const binding={...sourceBinding,fixtureId:fixture.fixtureId,harnessId,harnessCaseId},input=join(dir,"input.json"),invocation={targetPath,targetSourceSha256:hashes.target,exportName:sourceBinding.exportName};
    writeFileSync(input,JSON.stringify({binding,evidenceCommit,runtimeSourceHashes,invocation}));
    execFileSync(process.execPath,["--import","tsx",resolve(root,harnessPath),input,dir,resolve(root,targetPath)],{stdio:"pipe",timeout:60000,maxBuffer:8*1024*1024});
    const reply=readFileSync(join(dir,"reply.raw"),"utf8"),result=readFileSync(join(dir,"result.raw"),"utf8"),trace=JSON.parse(readFileSync(join(dir,"trace.json"),"utf8"));
    if(reply!=="NO_REPLY"||JSON.stringify(JSON.parse(result))!==JSON.stringify(sourceBinding.expectedResult))throw new Error(`Wave17 independent output drift: ${sourceBinding.consumerId}:${sourceBinding.scenarioKind}`);
    if(trace.transaction!=="READ_ONLY"||trace.sourceDomainDmlCount!==0||trace.rowCount!==0||trace.normalizedStatements.length!==0)throw new Error(`Wave17 READ_ONLY/DML0 drift: ${sourceBinding.consumerId}:${sourceBinding.scenarioKind}`);
    const replyHash=sha256CanonicalText(reply),resultHash=sha256CanonicalText(result),dmlHash=sha256CanonicalJson({normalizedStatements:[],rowCount:0});
    const payload:Omit<ObjectDbConsumerExecutionReceipt,"receiptSha256">={receiptId:`receipt:wave17:${sourceBinding.consumerId}:${sourceBinding.scenarioKind.toLowerCase()}`,consumerId:sourceBinding.consumerId,proofMode:"DIRECT",harness:{harnessId,harnessCaseId,runner:"NODE_OBJECT_DB_PARITY_V1",path:harnessPath,sourceSha256:hashes.harness},fixture:{fixtureId:fixture.fixtureId,path:fixturePath,sha256:hashes.fixture},invocation,scenario:{scenarioId:sourceBinding.scenarioId,scenarioKind:sourceBinding.scenarioKind},expectedActual:{reply:{expectedSha256:replyHash,actualSha256:replyHash,match:true},result:{expectedSha256:resultHash,actualSha256:resultHash,match:true},dml:{expectedSha256:dmlHash,actualSha256:dmlHash,match:true,expectedNormalizedStatements:[],actualNormalizedStatements:[],expectedRowCount:0,actualRowCount:0},lockOrder:{expected:[],actual:[],match:true},transaction:{expected:"READ_ONLY",actual:"READ_ONLY",match:true,expectedTimeline:["READ_ONLY"],actualTimeline:["READ_ONLY"]}},equivalenceRule:null,verdict:"PASS"};
    added.push({...payload,receiptSha256:sha256CanonicalJson(payload)});
  }finally{rmSync(dir,{recursive:true,force:true});}
}
const receipts=[...prior.receipts,...added];
if(added.length!==10||receipts.length!==177||new Set(receipts.map(receipt=>receipt.receiptId)).size!==177)throw new Error("Wave17 active receipt cardinality drift");
writeFileSync(resolve(root,outputPath),JSON.stringify({format:prior.format,catalogVersion:prior.catalogVersion,classificationBaseCommit:prior.classificationBaseCommit,evidenceCommit,receipts},null,2)+"\n");
console.log(JSON.stringify({status:"PASS",preservedWave16:167,addedWave17:10,total:177,evidenceCommit}));
