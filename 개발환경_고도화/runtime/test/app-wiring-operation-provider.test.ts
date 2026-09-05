import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { CapableDatabaseClient, ControlledDatabaseTransaction, DatabaseTransaction, DatabaseWriteResult, ReadOnlySnapshotTransaction } from "../src/database.js";
import { MariaAppWiringOperationProvider } from "../src/dispatch/app-wiring-operation-provider.js";
import { createEnvironmentContext, verifyStartupDatabaseIdentity } from "../src/runtime/environment-context.js";

type Row = Record<string, unknown>;
class MemoryDatabase implements CapableDatabaseClient {
  row?: Row;
  readonly statements:string[]=[];
  async ping() {} async verifyRollback(){return true;} async close(){}
  async query<T>(sql:string):Promise<T>{if(sql==="SELECT DATABASE() AS database_identity")return [{database_identity:"hoi_bot"}] as T;return [] as T;}
  async execute():Promise<DatabaseWriteResult>{throw new Error("RAW_POOL_WRITE_FORBIDDEN");}
  async withTransaction<T>(work:(tx:DatabaseTransaction)=>Promise<T>):Promise<T>{return this.withControlledTransaction(work as (tx:ControlledDatabaseTransaction)=>Promise<T>);}
  async withReadOnlySnapshot<T>(work:(tx:ReadOnlySnapshotTransaction)=>Promise<T>):Promise<T>{return work({query:async<R>()=>[] as R});}
  async withControlledTransaction<T>(work:(tx:ControlledDatabaseTransaction)=>Promise<T>):Promise<T>{
    const before=this.row===undefined?undefined:{...this.row};
    const tx:ControlledDatabaseTransaction={query:async<R>(sql:string,values:readonly unknown[]=[])=>this.txQuery<R>(sql,values),execute:(sql,values=[])=>this.txExecute(sql,values),withSavepoint:async<R>(nested:(tx:ControlledDatabaseTransaction)=>Promise<R>)=>nested(tx)};
    try{return await work(tx);}catch(error){this.row=before;throw error;}
  }
  private async txQuery<T>(sql:string,values:readonly unknown[]):Promise<T>{
    if(sql.includes("FROM canonical_app_wiring_operations"))return (this.row?.request_identity_fingerprint===values[0]?[this.row]:[]) as T;
    return [] as T;
  }
  private async txExecute(sql:string,values:readonly unknown[]):Promise<DatabaseWriteResult>{
    this.statements.push(sql);
    if(sql.startsWith("INSERT INTO canonical_app_wiring_operations")){
      if(this.row)throw Object.assign(new Error("Duplicate entry"),{code:"ER_DUP_ENTRY"});
      this.row={app_wiring_operation_id:values[0],request_identity_fingerprint:values[1],request_namespace:values[2],entrypoint_kind:values[3],external_request_id:values[4],request_key:values[5],payload_fingerprint:values[6],route:values[9],reason_code:values[10],command_code:values[11],handler_key:values[12],claim_state:"CLAIMED",effect_mode:values[13],lease_token:values[14],lease_generation:1n,lease_expires_time:values[15],attempt_count:1n,recovery_status:"NONE",recovery_code:null,result_json:null,error_code:null};
      return {affectedRows:1n,insertId:0n};
    }
    if(sql.includes("recovery_status='RECOVERED'")){this.row!.effect_mode=this.row!.effect_mode??(["SHADOW","REJECT"].includes(String(this.row!.route))?"READ_ONLY":"MUTATION");this.row!.lease_token=values[0];this.row!.lease_generation=values[1];this.row!.lease_expires_time=values[2];this.row!.attempt_count=BigInt((this.row!.attempt_count as bigint|null)??0n)+1n;this.row!.recovery_status="RECOVERED";this.row!.recovery_code="EXPIRED_CLAIM_TAKEOVER";return {affectedRows:1n,insertId:0n};}
    return {affectedRows:0n,insertId:0n};
  }
}
const clock=()=>new Date("2026-09-04T00:00:00.000Z");
async function make(database:MemoryDatabase){const env=await verifyStartupDatabaseIdentity(database,createEnvironmentContext({environmentCode:"dev",databaseIdentity:"hoi_bot"}));return new MariaAppWiringOperationProvider(database,env,()=>"a1234567",1,clock,()=>"b".repeat(64));}
const input=(payload:unknown={})=>({entrypointKind:"WEB" as const,externalRequestId:"request-1",normalizedPayload:payload,actor:"web"});

describe("MariaAppWiringOperationProvider T0 claim",()=>{
  it("persists the complete 466 lease/effect shape and canonical payload",async()=>{
    const database=new MemoryDatabase();const provider=await make(database);
    const claim=await provider.prepare(input({z:1,a:{y:2,x:3}}),()=>({route:"MODERN",effectMode:"MUTATION",reasonCode:"ROLLOUT",handlerKey:"modern.write"}));
    if(claim.replayed)throw new Error("unexpected replay");
    assert.equal(claim.claim.effectMode,"MUTATION");assert.equal(database.row?.lease_token,"b".repeat(64));assert.equal(database.row?.lease_generation,1n);assert.equal(database.row?.attempt_count,1n);assert.equal(database.row?.recovery_status,"NONE");assert.equal(database.row?.recovery_code,null);
    assert.match(String(database.row?.lease_expires_time),/^2026-09-04 09:00:30$/);
    assert.match(database.statements[0]!,/effect_mode,lease_token,lease_generation,lease_expires_time,attempt_count,recovery_status,recovery_code/);
    await assert.rejects(()=>provider.prepare(input({a:{x:3,y:2},z:1}),()=>{throw new Error("route must not re-resolve");}),/APP_WIRING_REQUEST_IN_PROGRESS/);
  });

  it("rejects invalid route/effect combinations before insert",async()=>{
    const provider=await make(new MemoryDatabase());
    await assert.rejects(()=>provider.prepare(input(),()=>({route:"SHADOW",effectMode:"MUTATION",reasonCode:"BAD",handlerKey:"shadow"})),/APP_WIRING_ROUTE_EFFECT_INVALID/);
  });

  it("fails payload drift and never automatically retries MUTATION_STARTED",async()=>{
    const database=new MemoryDatabase();const provider=await make(database);
    await provider.prepare(input({value:1}),()=>({route:"MODERN",effectMode:"MUTATION",reasonCode:"WRITE",handlerKey:"write"}));
    await assert.rejects(()=>provider.prepare(input({value:2}),()=>({route:"MODERN",effectMode:"MUTATION",reasonCode:"WRITE",handlerKey:"write"})),/APP_WIRING_PAYLOAD_DRIFT/);
    database.row!.claim_state="MUTATION_STARTED";database.row!.lease_expires_time="2026-09-04 08:00:00";
    await assert.rejects(()=>provider.prepare(input({value:1}),()=>({route:"MODERN",effectMode:"MUTATION",reasonCode:"WRITE",handlerKey:"write"})),/APP_WIRING_MUTATION_RECOVERY_REQUIRED/);
  });

  it("takes over only an expired CLAIMED row with a new fence generation",async()=>{
    const database=new MemoryDatabase();const provider=await make(database);
    await provider.prepare(input(),()=>({route:"MODERN",effectMode:"READ_ONLY",reasonCode:"READ",handlerKey:"read"}));
    database.row!.lease_expires_time="2026-09-04 08:59:59";
    const takeover=await provider.prepare(input(),()=>{throw new Error("no re-resolve");});
    assert.equal(takeover.replayed,false);assert.equal(database.row?.lease_generation,2n);assert.equal(database.row?.attempt_count,2n);assert.equal(database.row?.recovery_status,"RECOVERED");assert.equal(database.row?.recovery_code,"EXPIRED_CLAIM_TAKEOVER");
  });
  it("fails closed on the all-null pre-cutover active bundle without inferring an effect",async()=>{const database=new MemoryDatabase(),provider=await make(database);await provider.prepare(input(),()=>({route:"MODERN",effectMode:"MUTATION",reasonCode:"WRITE",handlerKey:"write"}));Object.assign(database.row!,{effect_mode:null,lease_token:null,lease_generation:null,lease_expires_time:null,attempt_count:null,recovery_status:null,recovery_code:null});const before=database.statements.length;await assert.rejects(()=>provider.prepare(input(),()=>{throw new Error("no re-resolve");}),/APP_WIRING_LEGACY_ACTIVE_DRAIN_REQUIRED/);assert.equal(database.statements.length,before);assert.equal(database.row?.effect_mode,null);});
  it("replays an all-null legacy terminal without inventing an effect",async()=>{const database=new MemoryDatabase(),provider=await make(database);await provider.prepare(input(),()=>({route:"MODERN",effectMode:"MUTATION",reasonCode:"WRITE",handlerKey:"write"}));Object.assign(database.row!,{claim_state:"COMPLETED",result_json:'{"status":"OK"}',effect_mode:null,lease_token:null,lease_generation:null,lease_expires_time:null,attempt_count:null,recovery_status:null,recovery_code:null});const replay=await provider.prepare(input(),()=>{throw new Error("no re-resolve");});assert.equal(replay.replayed,true);assert.equal("effectMode" in replay.claim,false);assert.equal("legacyTerminalMetadata" in replay.claim,true);});
  it("declares all eleven typed receipt table/id/status mappings",()=>{const source=readFileSync(new URL("../src/dispatch/app-wiring-operation-provider.ts",import.meta.url),"utf8");for(const [kind,column,table] of [["DAILY_PRAYER","daily_prayer_operation_id","canonical_daily_prayer_operations"],["HOME_AGGREGATE","home_aggregate_operation_id","canonical_home_aggregate_operations"],["MARKET","market_operation_id","canonical_market_operations"],["MEMBER_TITLE","member_title_operation_id","canonical_member_title_operations"],["MINI_PET_TITLE","mini_pet_title_operation_id","canonical_mini_pet_title_operations"],["PACKAGE_USE","package_use_operation_id","canonical_package_use_operations"],["PET_EXPLORE","pet_explore_operation_id","canonical_pet_explore_operations"],["PET_EXPLORE_EVENT_CONTROL","pet_explore_event_control_operation_id","canonical_pet_explore_event_control_operations"],["PET_TITLE","pet_title_operation_id","canonical_pet_title_operations"],["PET_TITLE_BATCH","pet_title_batch_operation_id","canonical_pet_title_batch_operations"],["PLAYER_IDENTITY","player_identity_operation_id","canonical_player_identity_operations"]])assert.match(source,new RegExp(`${kind}: \\["${column}","${table}","operation_status"`));});
});
