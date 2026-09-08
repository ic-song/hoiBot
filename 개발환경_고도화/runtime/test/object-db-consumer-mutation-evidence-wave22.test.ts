import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { validateObjectDbMutationScenarioEvidence,type ObjectDbMutationEvidenceContract,type ObjectDbMutationScenarioEvidence } from "../src/data-migration/object-db-consumer-mutation-evidence.js";
const root=resolve(import.meta.dirname,"../..");
const fixture=JSON.parse(readFileSync(resolve(root,"migration-control/contracts/object-db-consumer-executable-parity-wave22-furniture-grant-v1.json"),"utf8"));
const contract=fixture.mutationContract as ObjectDbMutationEvidenceContract,clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
test("Wave22 strict schema and six sealed scenarios pass",()=>{const Ajv2020=createRequire(import.meta.url)("ajv/dist/2020").default,validate=new Ajv2020({allErrors:true,strict:true}).compile(JSON.parse(readFileSync(resolve(root,"migration-control/contracts/object-db-consumer-mutation-evidence-wave22.v1.schema.json"),"utf8")));assert.equal(validate(fixture),true,JSON.stringify(validate.errors));assert.equal(fixture.sealedObservations.length,6);for(const evidence of fixture.sealedObservations)validateObjectDbMutationScenarioEvidence(contract,evidence);});
test("Wave22 seals DB locator, exact rows, hashes, per-attempt failure and lock order",()=>{
  const success=fixture.sealedObservations[0] as ObjectDbMutationScenarioEvidence;
  const failure=fixture.sealedObservations.find((candidate:{scenarioKind:string})=>candidate.scenarioKind==="DOMAIN_FAILURE_ROLLBACK") as ObjectDbMutationScenarioEvidence;
  const cases:Array<[ObjectDbMutationScenarioEvidence,(value:ObjectDbMutationScenarioEvidence)=>void]>=[
    [success,value=>{value.traces[0]!.locatorProjection!.locatorOK=false as never;}],
    [success,value=>{(value.traces[0]!.locatorProjection!.rows[0] as Record<string,unknown>).result_status="corrupt";}],
    [success,value=>{value.traces[0]!.beforeSha256="0".repeat(64);}],
    [success,value=>{const rows=value.traces[0]!.afterRows!.object_owned_furniture_instances;assert.ok(rows);const row=rows[0];assert.ok(row);row.ownership_status="placed";}],
    [success,value=>{value.traces[0]!.lockOrder.splice(1,1);}],
    [success,value=>{value.traces[0]!.transactionAttempts[0]!.lockOrder!.splice(1,1);}],
    [success,value=>{value.traces[0]!.transactionAttempts[0]!.attemptedDmlStatements[0]="INSERT INTO forbidden_table VALUES (?)";}],
    [failure,value=>{value.traces[0]!.transactionAttempts[0]!.failure!.errno=1205;}],
  ];
  for(const [baseline,mutate] of cases){const value=clone(baseline);mutate(value);assert.throws(()=>validateObjectDbMutationScenarioEvidence(contract,value));}
});
test("Wave22 rollback, restart, drift, and concurrency remain fail closed",()=>{for(const kind of ["DOMAIN_FAILURE_ROLLBACK","PAYLOAD_DRIFT_FAIL_CLOSED","RESTART_REPLAY","CONCURRENCY_SINGLE_WRITER"]){const evidence=clone(fixture.sealedObservations.find((candidate:{scenarioKind:string})=>candidate.scenarioKind===kind)) as ObjectDbMutationScenarioEvidence;if(kind==="RESTART_REPLAY")evidence.traces[1]!.processId=evidence.traces[0]!.processId;else if(kind==="CONCURRENCY_SINGLE_WRITER")evidence.traces[1]!.replayed=false;else{const oracle=contract.scenarios.find(candidate=>candidate.scenarioKind===kind);assert.ok(oracle);const primary=evidence.traces.find(trace=>trace.role===oracle.primaryRole);assert.ok(primary);primary.after.object_owned_furniture_instances=(primary.after.object_owned_furniture_instances??0)+1;}assert.throws(()=>validateObjectDbMutationScenarioEvidence(contract,evidence));}});
