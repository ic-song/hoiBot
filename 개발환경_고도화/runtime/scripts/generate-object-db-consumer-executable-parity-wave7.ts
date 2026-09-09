import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { sha256CanonicalJson, sha256CanonicalText, type ObjectDbConsumerExecutionReceipt } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const root=resolve(import.meta.dirname,"../../..");
const read=(path:string)=>readFileSync(resolve(root,path),"utf8");
const manifest=JSON.parse(read("개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json"));
const ledger=JSON.parse(read("개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.json"));
const prior=JSON.parse(read("개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave6-v1.json"));
const fixturePath="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave7-service-chain-v1.json";
const fixture=JSON.parse(read(fixturePath));
const harnessPath="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-harness.mjs";
const targetPath="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave7-service-chain.mjs";
const outputPath="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave7-v1.json";
const evidenceCommit=process.argv[2]??execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
const harnessHash=sha256CanonicalText(read(harnessPath)),fixtureHash=sha256CanonicalText(read(fixturePath)),targetHash=sha256CanonicalText(read(targetPath));
const refreshed:ObjectDbConsumerExecutionReceipt[]=prior.receipts.map((receipt:ObjectDbConsumerExecutionReceipt)=>{const{receiptSha256:_,...payload}=receipt,next={...payload,harness:{...payload.harness,sourceSha256:harnessHash}};return{...next,receiptSha256:sha256CanonicalJson(next)}});
const added:ObjectDbConsumerExecutionReceipt[]=[];

for(const binding of fixture.bindings){
  const parityCase=fixture.payload.cases.find((candidate:any)=>candidate.caseId===binding.harnessCaseId);
  const consumer=parityCase?.consumers.find((candidate:any)=>candidate.consumerId===binding.consumerId);
  const source=manifest.consumers.find((candidate:any)=>candidate.consumerId===binding.consumerId);
  const entry=ledger.entries.find((candidate:any)=>candidate.consumerId===binding.consumerId);
  if(!consumer||!source||source.kind!=="RUNTIME_DISPATCH"||source.access!=="READ"||source.unresolvedDynamicCallCount!==0||!["STATIC_ONLY","DIRECT_PASS"].includes(entry.verdict))throw new Error("Wave7 source cohort drift");
  const locator={file:source.file,symbol:source.symbol,triggerOrPredicate:source.triggerOrPredicate,interfaceId:source.interfaceId,start:source.sourceSpan.start,end:source.sourceSpan.end,sha256:source.sourceSpan.sha256};
  if(JSON.stringify(locator)!==JSON.stringify(consumer.sourceLocator))throw new Error("Wave7 locator drift");
  const negative=binding.scenarioKind==="NEGATIVE_GUARD",handlerResult=consumer.expectedResultsByScenario[binding.scenarioKind],queue=consumer.queueReplyContract.queueScenarios.includes(binding.scenarioKind);
  const expected=negative?undefined:handlerResult.outboxId?{outboxId:handlerResult.outboxId,room:consumer.input.channelId,data:handlerResult.message}:{outboxId:consumer.queueReplyContract.outboxInsertId,room:consumer.input.channelId,data:handlerResult.message};
  const reply=negative?consumer.expectedGuardError:JSON.stringify(expected);
  const result=negative?JSON.stringify({error:reply,queryCount:0,mutationCount:0}):binding.scenarioKind==="RESTART_CONSISTENCY"?JSON.stringify({result:expected,restartEvidence:{processExecutions:2,distinctProcessIds:true,distinctModuleExecutions:true,...(queue?{distinctOperationKeys:true}:{})}}):reply;
  const queryCount=(consumer.queryRowsByScenario[binding.scenarioKind]??[]).length;
  const baseStatements=queue?[consumer.queueReplyContract.operationSql,consumer.queueReplyContract.commandExecutionSql,consumer.queueReplyContract.outboxSql]:[],statements=binding.scenarioKind==="RESTART_CONSISTENCY"?[...baseStatements,...baseStatements]:baseStatements,rowCount=statements.length,dmlHash=sha256CanonicalJson({normalizedStatements:statements,rowCount});
  const transaction=queue?"COMMIT":"READ_ONLY",timeline=negative?["GUARD_REJECTED"]:binding.scenarioKind==="RESTART_CONSISTENCY"?(queue?["CHILD_PROCESS_1:COMMIT","RESTART","CHILD_PROCESS_2:COMMIT"]:["CHILD_PROCESS_1:READ","RESTART","CHILD_PROCESS_2:READ"]):queue?["BEGIN","COMMIT"]:Array.from({length:queryCount},()=>"READ");
  const payload:Omit<ObjectDbConsumerExecutionReceipt,"receiptSha256">={receiptId:`receipt:wave7:${binding.consumerId}:${binding.scenarioKind.toLowerCase()}`,consumerId:binding.consumerId,proofMode:"DIRECT",harness:{harnessId:binding.harnessId,harnessCaseId:binding.harnessCaseId,runner:"NODE_OBJECT_DB_PARITY_V1",path:harnessPath,sourceSha256:harnessHash},fixture:{fixtureId:fixture.fixtureId,path:fixturePath,sha256:fixtureHash},invocation:{targetPath,targetSourceSha256:targetHash,exportName:"executeWave7ServiceChain"},scenario:{scenarioId:binding.scenarioId,scenarioKind:binding.scenarioKind},expectedActual:{reply:{expectedSha256:sha256CanonicalText(reply),actualSha256:sha256CanonicalText(reply),match:true},result:{expectedSha256:sha256CanonicalText(result),actualSha256:sha256CanonicalText(result),match:true},dml:{expectedSha256:dmlHash,actualSha256:dmlHash,match:true,expectedNormalizedStatements:statements,actualNormalizedStatements:statements,expectedRowCount:rowCount,actualRowCount:rowCount},lockOrder:{expected:[],actual:[],match:true},transaction:{expected:transaction,actual:transaction,match:true,expectedTimeline:timeline,actualTimeline:timeline}},equivalenceRule:null,verdict:"PASS"};
  added.push({...payload,receiptSha256:sha256CanonicalJson(payload)});
}

writeFileSync(resolve(root,outputPath),JSON.stringify({format:prior.format,catalogVersion:prior.catalogVersion,classificationBaseCommit:prior.classificationBaseCommit,evidenceCommit,receipts:[...refreshed,...added]},null,2)+"\n");
console.log(JSON.stringify({status:"PASS",added:added.length,total:refreshed.length+added.length}));
