import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { validateObjectDbMutationScenarioEvidence, type ObjectDbMutationScenarioEvidence, type ObjectDbMutationTrace } from "../src/data-migration/object-db-consumer-mutation-evidence.js";

const runtimeRoot=resolve(import.meta.dirname,"..");
const repoRoot=resolve(runtimeRoot,"../..");
const fixturePath=resolve(repoRoot,"개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave21-pet-equipment-assign-v1.json");
const targetPath=resolve(runtimeRoot,"test/fixtures/object-db-executable-parity-wave21-pet-equipment-assign.mjs");
const fixture=JSON.parse(readFileSync(fixturePath,"utf8"));
const contract=fixture.mutationContract;
const runRoot=mkdtempSync(join(tmpdir(),"wave21-pet-equipment-assign-live-"));

function run(request:Record<string,unknown>,name:string):ObjectDbMutationTrace{
  const input=join(runRoot,`${name}.input.json`),output=join(runRoot,`${name}.output.json`);
  writeFileSync(input,JSON.stringify({...request,source:contract.source}),"utf8");
  execFileSync(process.execPath,["--import","tsx",targetPath,input,output],{cwd:runtimeRoot,stdio:"pipe",timeout:120_000,maxBuffer:16*1024*1024});
  return JSON.parse(readFileSync(output,"utf8"));
}
async function concurrent(request:Record<string,unknown>,name:string):Promise<ObjectDbMutationTrace>{
  const input=join(runRoot,`${name}.input.json`),output=join(runRoot,`${name}.output.json`);
  writeFileSync(input,JSON.stringify({...request,source:contract.source}),"utf8");
  await new Promise<void>((accept,reject)=>{const child=spawn(process.execPath,["--import","tsx",targetPath,input,output],{cwd:runtimeRoot,stdio:"pipe"});let error="";child.stderr.on("data",value=>{error+=String(value);});child.once("error",reject);child.once("close",code=>code===0?accept():reject(new Error(`Wave21 concurrent child failed (${code}): ${error}`)));});
  return JSON.parse(readFileSync(output,"utf8"));
}
function reset(name:string):void{run({mode:"RESET"},`${name}-reset`);}
async function collect():Promise<ObjectDbMutationScenarioEvidence[]>{
  const result:ObjectDbMutationScenarioEvidence[]=[];
  reset("success");result.push({scenarioKind:"MUTATION_SUCCESS",traces:[run({role:"PRIMARY",scenarioKey:"success"},"success")]});
  reset("failure");result.push({scenarioKind:"DOMAIN_FAILURE_ROLLBACK",traces:[run({role:"PRIMARY",scenarioKey:"failure",domainFailure:true},"failure")]});
  reset("duplicate");result.push({scenarioKind:"DUPLICATE_REPLAY_DML_ZERO",traces:[run({role:"SEED",scenarioKey:"duplicate"},"duplicate-seed"),run({role:"REPLAY",scenarioKey:"duplicate"},"duplicate-replay")]});
  reset("drift");result.push({scenarioKind:"PAYLOAD_DRIFT_FAIL_CLOSED",traces:[run({role:"SEED",scenarioKey:"drift"},"drift-seed"),run({role:"PRIMARY",scenarioKey:"drift",drift:true},"drift-primary")]});
  reset("restart");result.push({scenarioKind:"RESTART_REPLAY",traces:[run({role:"SEED",scenarioKey:"restart"},"restart-seed"),run({role:"REPLAY",scenarioKey:"restart"},"restart-replay")]});
  reset("concurrency");const pair=await Promise.all([concurrent({role:"CONCURRENT",scenarioKey:"concurrency"},"concurrency-a"),concurrent({role:"CONCURRENT",scenarioKey:"concurrency"},"concurrency-b")]);
  const writer=pair.find(trace=>trace.committedRowCount>0),replay=pair.find(trace=>trace!==writer);if(!writer||!replay||replay.replayed!==true||replay.committedRowCount!==0)throw new Error(`Wave21 concurrency cardinality drift: ${JSON.stringify(pair)}`);
  writer.role="PRIMARY";replay.role="CONCURRENT";result.push({scenarioKind:"CONCURRENCY_SINGLE_WRITER",traces:[writer,replay]});
  for(const evidence of result)validateObjectDbMutationScenarioEvidence(contract,evidence);return result;
}
try{fixture.sealedObservations=await collect();writeFileSync(fixturePath,`${JSON.stringify(fixture,null,2)}\n`,"utf8");console.log(JSON.stringify({status:"PASS",scenarios:fixture.sealedObservations.length}));}finally{rmSync(runRoot,{recursive:true,force:true});}
