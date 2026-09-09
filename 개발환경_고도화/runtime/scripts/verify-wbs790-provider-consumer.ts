import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { MariaDatabaseClient } from "../src/database.js";

const runtime=resolve(import.meta.dirname,".."), root=resolve(runtime,"../.."), out=resolve(root,"개발환경_고도화/migration-control/evidence/wbs790-consumer-gate7-lease2622");
const phase=process.argv[2]; assert.ok(phase==="before"||phase==="after");
for(const [key,value] of Object.entries({DATABASE_HOST:"127.0.0.1",DATABASE_PORT:"3358",DATABASE_NAME:"hoibot_wave24_item_stack_quantity_2622",DATABASE_USER:"root",DATABASE_PASSWORD:"lease2622-isolated-only"})) assert.equal(process.env[key],value);
const db=new MariaDatabaseClient({enabled:true,host:"127.0.0.1",port:3358,name:"hoibot_wave24_item_stack_quantity_2622",user:"root",password:"lease2622-isolated-only",connectionLimit:2,connectTimeoutMs:5000});
const target="test/fixtures/object-db-executable-parity-wave24-target.mjs";
const immutablePaths=["개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.json","개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave24-mutations-v1.json","개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave23-v1.json","개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave24-v1.json","개발환경_고도화/runtime/"+target];
// 기존 fixture와 공용 원장의 바이트를 검사한다.
function hashes(){return Object.fromEntries(immutablePaths.map(path=>[path,createHash("sha256").update(readFileSync(resolve(root,path))).digest("hex")]));}
const beforeHashes=hashes();
// 공용 target을 새 프로세스에서 호출하고 소비자 전용 evidence만 생성한다.
function invoke(name:string,request:Record<string,unknown>) {
  const input=resolve(out,name+"-input.json"),output=resolve(out,name+"-actual.json");
  writeFileSync(input,JSON.stringify({consumerId:"sql-repository-87ed81931dd7417b",...request}),"utf8");
  execFileSync(process.execPath,["--import","tsx",target,input,output],{cwd:runtime,env:process.env,timeout:60000,stdio:"pipe"});
  return JSON.parse(readFileSync(output,"utf8"));
}
// trigger가 갱신하는 head/orderings도 포함해 raw row 상태를 독립 비교한다.
async function snapshot(){
  const state:Record<string,unknown>={};
  for(const table of ["canonical_players","canonical_item_definitions","canonical_owned_item_stacks","canonical_item_inventory_operations","canonical_item_inventory_ledger_entries","canonical_item_inventory_ledger_heads","canonical_item_inventory_ledger_orderings"]){
    const rows=await db.query<Record<string,unknown>[]>(`SELECT * FROM ${table}`);
    state[table]=rows.map(row=>JSON.parse(JSON.stringify(row,(_key,v)=>typeof v==="bigint"?v.toString():v))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return state;
}
// 성공과 재실행을 producer의 expected 값과 독립된 고정 기대값으로 확인한다.
function success(actual:any,replayed:boolean){assert.equal(actual.errorCode,null);assert.deepEqual(actual.result,{quantity:"3",replayed});assert.equal(actual.committedRows,replayed?0:4);assert.equal(actual.locatorProjection.rows.length,1);const row=actual.locatorProjection.rows[0];assert.equal(row.player_id,"player01");assert.equal(row.item_id,"item0001");assert.equal(row.quantity,"3");assert.equal(row.quantity_delta,"3");assert.equal(row.operation_status,"completed");}
try {
  const manifest=JSON.parse(readFileSync(resolve(root,"개발환경_고도화/migration-control/contracts/object-data-model-standard.v1.json"),"utf8"));
  assert.equal(manifest.tables.length,119);
  const names=new Set((await db.query<{TABLE_NAME:string}[]>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()")).map(row=>row.TABLE_NAME));
  for(const table of manifest.tables)assert.ok(names.has(table.table??table.tableName??table.name));
  assert.equal(Number((await db.query<{n:bigint}[]>("SELECT COUNT(*) n FROM schema_migrations"))[0]!.n),478);
  if(phase==="before"){
    invoke("reset",{mode:"RESET"});
    const seed=invoke("seed",{scenario:"consumer-restart"}); success(seed,false);
    const before=await snapshot();
    const replay=invoke("duplicate",{scenario:"consumer-restart"});success(replay,true);assert.equal(replay.attempts.flatMap((v:any)=>v.targetDml).length,0);assert.deepEqual(await snapshot(),before);
    const drift=invoke("drift",{scenario:"consumer-restart",drift:true});assert.equal(drift.errorCode,"CANONICAL_ITEM_REPLAY_CORRUPTED");assert.equal(drift.committedRows,0);assert.equal(drift.attempts.flatMap((v:any)=>v.targetDml).length,0);assert.deepEqual(await snapshot(),before);
    writeFileSync(resolve(out,"before.json"),JSON.stringify({pid:process.pid,seedPid:seed.processId,state:before,hashes:beforeHashes},null,2)+"\n");
    console.log("CONSUMER_BEFORE_PASS success=3 duplicateDml=0 driftDml=0 registered119 migrations478");
  }else{
    const prior=JSON.parse(readFileSync(resolve(out,"before.json"),"utf8")); assert.notEqual(prior.pid,process.pid); assert.deepEqual(prior.hashes,beforeHashes);assert.deepEqual(await snapshot(),prior.state);
    const replay=invoke("db-restart-replay",{scenario:"consumer-restart"});success(replay,true);assert.notEqual(prior.seedPid,replay.processId);assert.equal(replay.attempts.flatMap((v:any)=>v.targetDml).length,0);assert.deepEqual(await snapshot(),prior.state);
    invoke("shadow-reset",{mode:"RESET"});const before=await snapshot();
    const shadow=invoke("shadow",{mode:"SHADOW",scenario:"consumer-shadow"});
    assert.equal(shadow.errorCode,"WAVE24_SHADOW_ROLLBACK");assert.deepEqual(shadow.result,{quantity:"3",replayed:false});assert.equal(shadow.committedRows,0);assert.equal(shadow.rolledBackAffectedRows,4);assert.deepEqual(shadow.attempts.map((v:any)=>v.outcome),["ROLLBACK"]);assert.equal(shadow.beforeSha256,shadow.afterSha256);assert.deepEqual(await snapshot(),before);
    assert.equal(shadow.externalNetworkCalls,0);assert.equal(shadow.replyCalls,0);
    writeFileSync(resolve(out,"after.json"),JSON.stringify({pid:process.pid,priorPid:prior.pid,replayPid:replay.processId,seedPid:prior.seedPid,shadow:{executedTarget:target,rollbackRows:4,committedRows:0,rawSevenTableSnapshotEqual:true,result:shadow.result},hashes:beforeHashes},null,2)+"\n");
    console.log("CONSUMER_AFTER_PASS dbRestartReplayDml=0 actualShadowRollback=4 committed=0 rawSevenTableSnapshotEqual=true");
  }
  assert.deepEqual(hashes(),beforeHashes);
}finally{await db.close();}
