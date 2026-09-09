import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { projectObjectDbMutationOracleResult, validateObjectDbMutationScenarioEvidence, type ObjectDbMutationEvidenceContract, type ObjectDbMutationScenarioEvidence } from "../src/data-migration/object-db-consumer-mutation-evidence.js";
import { sha256CanonicalJson, sha256CanonicalText, type ObjectDbConsumerExecutionReceipt } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const root=resolve(import.meta.dirname,"../../.."),read=(path:string)=>readFileSync(resolve(root,path),"utf8");
const priorPath="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave19-v1.json";
const fixturePath="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave20-package-import-v1.json";
const harnessPath="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave20-package-import-harness.mjs";
const targetPath="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave20-package-import.mjs";
const outputPath="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave20-v1.json";
const consumerId="sql-repository-b1d650b73c2ddff0",harnessId="harness:wave20:package-import",harnessCaseId="case:wave20:package-import",evidenceCommit=process.argv[2];
if(typeof evidenceCommit!=="string"||!/^[0-9a-f]{40}$/.test(evidenceCommit))throw new Error("Wave20 exact 40-character evidenceCommit required");
const committed=(path:string)=>{const listing=execFileSync("git",["ls-tree",evidenceCommit,"--",path],{cwd:root,encoding:"utf8"}),match=/^[0-9]+ blob ([0-9a-f]{40})\t/.exec(listing);if(match?.[1]===undefined)throw new Error(`Wave20 committed blob missing: ${path}`);return execFileSync("git",["cat-file","blob",match[1]],{cwd:root,encoding:"utf8",maxBuffer:16*1024*1024});};
type Binding={consumerId:string;scenarioId:string;scenarioKind:ObjectDbConsumerExecutionReceipt["scenario"]["scenarioKind"];exportName:string};
type Fixture={fixtureId:string;consumerId:string;runtimeSourcePaths:string[];mutationContract:ObjectDbMutationEvidenceContract;bindings:Binding[];sealedObservations:ObjectDbMutationScenarioEvidence[]};
const prior=JSON.parse(read(priorPath)),fixture=JSON.parse(committed(fixturePath))as Fixture,prefix=JSON.stringify(prior.receipts);
if(prior.receipts.length!==207||Buffer.byteLength(prefix,"utf8")!==849438||sha256CanonicalText(prefix)!=="92824417cd67180ed155edf01d39d8acc156c276f16077361f01b46a9193a9b2")throw new Error("Wave20 immutable Wave19 receipt prefix drift");
if(fixture.consumerId!==consumerId||fixture.bindings.length!==6||fixture.sealedObservations.length!==6||new Set(fixture.bindings.map(({scenarioKind})=>scenarioKind)).size!==6||fixture.bindings.some(binding=>binding.consumerId!==consumerId||binding.exportName!=="executeWave20PackageImport"))throw new Error("Wave20 fixture consumer/scenario drift");
const hashes={harness:sha256CanonicalText(committed(harnessPath)),fixture:sha256CanonicalText(committed(fixturePath)),target:sha256CanonicalText(committed(targetPath))},runtimeSourceHashes=fixture.runtimeSourcePaths.map(path=>({path,sha256:sha256CanonicalText(committed(path))}));
for(const[path,hash]of[[harnessPath,hashes.harness],[fixturePath,hashes.fixture],[targetPath,hashes.target],...runtimeSourceHashes.map(source=>[source.path,source.sha256]as const)]as const)if(sha256CanonicalText(read(path))!==hash)throw new Error(`Wave20 committed evidence/worktree drift: ${path}`);
const added:ObjectDbConsumerExecutionReceipt[]=[];
for(const binding of fixture.bindings){
  const directory=mkdtempSync(join(tmpdir(),"wave20-package-import-receipt-"));
  try{
    const inputPath=join(directory,"input.json"),invocation={targetPath,targetSourceSha256:hashes.target,exportName:binding.exportName};
    writeFileSync(inputPath,JSON.stringify({binding:{...binding,fixtureId:fixture.fixtureId,harnessId,harnessCaseId},fixturePayload:fixture,evidenceCommit,runtimeSourceHashes,invocation}),"utf8");
    execFileSync(process.execPath,["--import","tsx",resolve(root,harnessPath),inputPath,directory,resolve(root,targetPath)],{stdio:"pipe",timeout:120000,maxBuffer:16*1024*1024});
    const reply=readFileSync(join(directory,"reply.raw"),"utf8"),result=readFileSync(join(directory,"result.raw"),"utf8"),trace=JSON.parse(readFileSync(join(directory,"trace.json"),"utf8"))as ObjectDbMutationScenarioEvidence;
    const verified=validateObjectDbMutationScenarioEvidence(fixture.mutationContract,trace),oracle=fixture.mutationContract.scenarios.find(candidate=>candidate.scenarioKind===binding.scenarioKind);
    if(!oracle)throw new Error(`Wave20 oracle missing: ${binding.scenarioKind}`);
    const expectedResult=JSON.stringify(projectObjectDbMutationOracleResult(oracle));
    if(result!==expectedResult)throw new Error(`Wave20 independent result mismatch: ${binding.scenarioKind}`);
    const primary=verified.primary,actualTimeline=primary.transactionAttempts.flatMap(attempt=>[`ATTEMPT_${attempt.attempt}_BEGIN`,`ATTEMPT_${attempt.attempt}_${attempt.outcome}`]),expectedTimeline=Array.from({length:oracle.primaryTransactionAttempts},(_,index)=>[`ATTEMPT_${index+1}_BEGIN`,`ATTEMPT_${index+1}_${index+1===oracle.primaryTransactionAttempts?oracle.primaryTransactionOutcome:"ROLLBACK"}`]).flat();
    const dmlHash=sha256CanonicalJson({normalizedStatements:primary.committedDmlStatements,rowCount:primary.committedRowCount}),replyHash=sha256CanonicalText(reply),resultHash=sha256CanonicalText(result);
    const payload:Omit<ObjectDbConsumerExecutionReceipt,"receiptSha256">={receiptId:`receipt:wave20:${consumerId}:${binding.scenarioKind.toLowerCase()}`,consumerId,proofMode:"DIRECT",harness:{harnessId,harnessCaseId,runner:"NODE_OBJECT_DB_PARITY_V1",path:harnessPath,sourceSha256:hashes.harness},fixture:{fixtureId:fixture.fixtureId,path:fixturePath,sha256:hashes.fixture},invocation,scenario:{scenarioId:binding.scenarioId,scenarioKind:binding.scenarioKind},expectedActual:{reply:{expectedSha256:sha256CanonicalText("NO_REPLY"),actualSha256:replyHash,match:reply==="NO_REPLY"},result:{expectedSha256:sha256CanonicalText(expectedResult),actualSha256:resultHash,match:result===expectedResult},dml:{expectedSha256:dmlHash,actualSha256:dmlHash,match:true,expectedNormalizedStatements:primary.committedDmlStatements,actualNormalizedStatements:primary.committedDmlStatements,expectedRowCount:oracle.expectedCommittedRowCount,actualRowCount:primary.committedRowCount},lockOrder:{expected:oracle.expectedLockOrder,actual:primary.lockOrder,match:JSON.stringify(oracle.expectedLockOrder)===JSON.stringify(primary.lockOrder)},transaction:{expected:oracle.primaryTransactionOutcome,actual:primary.transactionAttempts.at(-1)!.outcome,match:oracle.primaryTransactionOutcome===primary.transactionAttempts.at(-1)!.outcome,expectedTimeline,actualTimeline}},equivalenceRule:null,verdict:"PASS"};
    if(!payload.expectedActual.reply.match||!payload.expectedActual.result.match||!payload.expectedActual.lockOrder.match||!payload.expectedActual.transaction.match)throw new Error(`Wave20 expected/actual mismatch: ${binding.scenarioKind}`);
    added.push({...payload,receiptSha256:sha256CanonicalJson(payload)});
  }finally{rmSync(directory,{recursive:true,force:true});}
}
const receipts=[...prior.receipts,...added];
if(added.length!==6||receipts.length!==213||new Set(receipts.map((receipt:{receiptId:string})=>receipt.receiptId)).size!==213)throw new Error("Wave20 receipt cardinality drift");
writeFileSync(resolve(root,outputPath),`${JSON.stringify({format:prior.format,catalogVersion:prior.catalogVersion,classificationBaseCommit:prior.classificationBaseCommit,evidenceCommit,receipts},null,2)}\n`,"utf8");
console.log(JSON.stringify({status:"PASS",preservedWave19:207,addedWave20:6,total:213,evidenceCommit}));
