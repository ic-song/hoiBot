import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

import { validateObjectDbMutationScenarioEvidence, type ObjectDbMutationEvidenceContract, type ObjectDbMutationScenarioEvidence, type ObjectDbMutationScenarioOracle, type ObjectDbMutationTrace } from "../src/data-migration/object-db-consumer-mutation-evidence.js";

const root=resolve(import.meta.dirname,"../..");
const fixturePath=resolve(root,"migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave20-package-import-v1.json");
const schemaPath=resolve(root,"migration-control/contracts/object-db-consumer-mutation-evidence-wave20.v1.schema.json");
const fixture=JSON.parse(readFileSync(fixturePath,"utf8"));
const Ajv2020=createRequire(import.meta.url)("ajv/dist/2020").default;
const contract=fixture.mutationContract as ObjectDbMutationEvidenceContract;
const clone=<T>(value:T):T=>structuredClone(value);
const statement=(table:string)=>`INSERT INTO ${table} (fixture_column) VALUES (?)`;

function trace(oracle:ObjectDbMutationScenarioOracle,role:ObjectDbMutationTrace["role"],processId:number):ObjectDbMutationTrace{
  const primary=role===oracle.primaryRole;
  const attempted=primary?oracle.expectedAttemptedDmlTableSequence.map(statement):[];
  const affected=primary?oracle.expectedAffectedDmlTableSequence.map(statement):[];
  const outcome=primary?oracle.primaryTransactionOutcome:"COMMIT";
  const affectedRowCount=primary?(outcome==="COMMIT"?oracle.expectedCommittedRowCount:oracle.expectedRolledBackAffectedRowCount):0;
  return{processId,moduleExecutionId:`00000000-0000-4000-8000-${String(processId).padStart(12,"0")}`,role,source:contract.source,database:{host:"127.0.0.1",port:3342,name:"hoibot_wave20_package_import_test"},transactionAttempts:[{attempt:1,outcome,attemptedDmlStatements:attempted,affectedDmlStatements:affected,affectedRowCount}],committedDmlStatements:outcome==="COMMIT"?affected:[],committedRowCount:outcome==="COMMIT"?affectedRowCount:0,rolledBackAffectedRowCount:outcome==="ROLLBACK"?affectedRowCount:0,lockOrder:primary?oracle.expectedLockOrder:[],before:primary?oracle.expectedBefore:oracle.expectedAfter,after:oracle.expectedAfter,replayed:primary?oracle.expectedReplayed:true,errorCode:primary?oracle.expectedErrorCode:null,externalNetworkCalls:0,replyCalls:0};
}

function evidence(oracle:ObjectDbMutationScenarioOracle):ObjectDbMutationScenarioEvidence{
  return{scenarioKind:oracle.scenarioKind,traces:oracle.traceRoles.map((role,index)=>trace(oracle,role,4100+index))};
}

test("Wave20 independent oracle validates six mutation scenarios",()=>{
  for(const oracle of contract.scenarios)assert.equal(validateObjectDbMutationScenarioEvidence(contract,evidence(oracle)).primary.role,oracle.primaryRole);
});

test("Wave20 strict schema rejects unsealed and nested unknown evidence",()=>{
  const ajv=new Ajv2020({allErrors:true,strict:true}),validate=ajv.compile(JSON.parse(readFileSync(schemaPath,"utf8")));
  const unsealed=clone(fixture);unsealed.sealedObservations=[];assert.equal(validate(unsealed),false);
  const sealed=clone(fixture);sealed.sealedObservations=contract.scenarios.map(evidence);assert.equal(validate(sealed),true,ajv.errorsText(validate.errors));
  sealed.sealedObservations[0].traces[0].unexpected=true;assert.equal(validate(sealed),false);
});

test("Wave20 validator fails closed on table, rollback, PID, database, source, and post-state tampering",()=>{
  const success=contract.scenarios.find(({scenarioKind})=>scenarioKind==="MUTATION_SUCCESS")!;
  const baseline=evidence(success);
  const cases:Array<(value:ObjectDbMutationScenarioEvidence)=>void>=[
    value=>{value.traces[0]!.transactionAttempts[0]!.attemptedDmlStatements[0]="INSERT INTO forbidden_table VALUES (?)";},
    value=>{value.traces[0]!.transactionAttempts[0]!.outcome="ROLLBACK";},
    value=>{value.traces[0]!.database.port=3306;},
    value=>{value.traces[0]!.source.sha256="0".repeat(64);},
    value=>{value.traces[0]!.after.canonical_package_reward_entries=value.traces[0]!.after.canonical_package_reward_entries!+1;},
  ];
  for(const mutate of cases){const value=clone(baseline);mutate(value);assert.throws(()=>validateObjectDbMutationScenarioEvidence(contract,value));}
  const restart=contract.scenarios.find(({scenarioKind})=>scenarioKind==="RESTART_REPLAY")!,restartEvidence=evidence(restart);restartEvidence.traces[1]!.processId=restartEvidence.traces[0]!.processId;assert.throws(()=>validateObjectDbMutationScenarioEvidence(contract,restartEvidence),/child process reuse/);
  const restartModule=evidence(restart);restartModule.traces[1]!.moduleExecutionId=restartModule.traces[0]!.moduleExecutionId;assert.throws(()=>validateObjectDbMutationScenarioEvidence(contract,restartModule),/module execution reuse/);
  const rollback=contract.scenarios.find(({scenarioKind})=>scenarioKind==="DOMAIN_FAILURE_ROLLBACK")!,forgedContract=clone(contract),forgedEvidence=evidence(rollback),forgedOracle=forgedContract.scenarios.find(({scenarioKind})=>scenarioKind==="DOMAIN_FAILURE_ROLLBACK")!;
  forgedOracle.expectedRolledBackAffectedRowCount=12;forgedOracle.expectedAffectedDmlTableSequence.pop();forgedEvidence.traces[0]!.transactionAttempts[0]!.affectedDmlStatements.pop();forgedEvidence.traces[0]!.transactionAttempts[0]!.affectedRowCount=12;forgedEvidence.traces[0]!.rolledBackAffectedRowCount=12;
  assert.throws(()=>validateObjectDbMutationScenarioEvidence(forgedContract,forgedEvidence),/independent oracle seal drift/);
});

test("Wave20 concurrency requires one committed writer and one zero-DML replay",()=>{
  const oracle=contract.scenarios.find(({scenarioKind})=>scenarioKind==="CONCURRENCY_SINGLE_WRITER")!,value=evidence(oracle);
  value.traces[1]!.replayed=false;
  assert.throws(()=>validateObjectDbMutationScenarioEvidence(contract,value),/writer\/replay cardinality/);
});
