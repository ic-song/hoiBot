import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CapableDatabaseClient, ControlledDatabaseTransaction, DatabaseTransaction, DatabaseWriteResult, ReadOnlySnapshotTransaction } from "../src/database.js";
import { MariaAppWiringOperationProvider } from "../src/dispatch/app-wiring-operation-provider.js";
import { createEnvironmentContext, verifyStartupDatabaseIdentity } from "../src/runtime/environment-context.js";

type Row=Record<string,unknown>;

class ReplyDatabase implements CapableDatabaseClient{
  claim?:Row;
  operation?:Row;
  execution?:Row;
  outbox?:Row;
  failOn?:"command"|"outbox"|"terminal";
  throwAfterCommitOnce=false;
  async ping(){} async verifyRollback(){return true;} async close(){}
  async query<T>(sql:string):Promise<T>{return (sql==="SELECT DATABASE() AS database_identity"?[{database_identity:"hoi_bot"}]:[]) as T;}
  async execute():Promise<DatabaseWriteResult>{throw new Error("RAW_POOL_WRITE_FORBIDDEN");}
  async withTransaction<T>(work:(tx:DatabaseTransaction)=>Promise<T>):Promise<T>{return this.withControlledTransaction(work as (tx:ControlledDatabaseTransaction)=>Promise<T>);}
  async withReadOnlySnapshot<T>(_work:(tx:ReadOnlySnapshotTransaction)=>Promise<T>):Promise<T>{throw new Error("SEPARATE_READ_SNAPSHOT_FORBIDDEN");}
  async withControlledTransaction<T>(work:(tx:ControlledDatabaseTransaction)=>Promise<T>):Promise<T>{
    const before={claim:this.claim&&{...this.claim},operation:this.operation&&{...this.operation},execution:this.execution&&{...this.execution},outbox:this.outbox&&{...this.outbox}};
    const tx:ControlledDatabaseTransaction={query:async<R>(sql:string,values:readonly unknown[]=[])=>this.txQuery<R>(sql,values),execute:(sql:string,values:readonly unknown[]=[])=>this.txExecute(sql,values),withSavepoint:async<R>(nested:(transaction:ControlledDatabaseTransaction)=>Promise<R>)=>nested(tx)};
    try{
      const result=await work(tx);
      if(this.throwAfterCommitOnce){this.throwAfterCommitOnce=false;throw Object.assign(new Error("COMMIT_RESULT_UNKNOWN"),{committed:true});}
      return result;
    }catch(error){if(!(typeof error==="object"&&error!==null&&"committed" in error))Object.assign(this,before);throw error;}
  }
  private async txQuery<T>(sql:string,values:readonly unknown[]):Promise<T>{
    if(sql.includes("FROM canonical_app_wiring_operations"))return (this.claim?.request_identity_fingerprint===values[0]?[this.claim]:[]) as T;
    if(sql.includes("FROM outbox_messages outbox")){
      if(this.outbox?.id?.toString()!==String(values[0])||this.operation===undefined||this.execution===undefined)return [] as T;
      return [{operation_id:this.operation.id,idempotency_scope:this.operation.idempotency_scope,idempotency_key:this.operation.idempotency_key,operation_status:this.operation.status,operation_result_json:this.operation.result_json,event_id:this.execution.event_id,command_code:this.execution.command_code,execution_status:this.execution.execution_status,result_code:this.execution.result_code,outbox_id:this.outbox.id,provider_code:"iris",destination_id:this.outbox.destination_id,message_type:"text",payload_json:this.outbox.payload_json}] as T;
    }
    if(sql.startsWith("SELECT title_name"))return [{title_name:"별빛"}] as T;
    return [] as T;
  }
  private async txExecute(sql:string,values:readonly unknown[]):Promise<DatabaseWriteResult>{
    if(sql.startsWith("INSERT INTO canonical_app_wiring_operations")){
      this.claim={app_wiring_operation_id:values[0],request_identity_fingerprint:values[1],request_namespace:values[2],entrypoint_kind:values[3],external_request_id:values[4],request_key:values[5],payload_fingerprint:values[6],route:values[9],reason_code:values[10],command_code:values[11],handler_key:values[12],claim_state:"CLAIMED",effect_mode:values[13],lease_token:values[14],lease_generation:1n,lease_expires_time:values[15],attempt_count:1n,recovery_status:"NONE",recovery_code:null,result_json:null,error_code:null};
      return {affectedRows:1n,insertId:0n};
    }
    if(sql.startsWith("INSERT INTO operations")){this.operation={id:11n,idempotency_scope:"app-wiring.read-only-reply",idempotency_key:values[1],status:"processing",result_json:null};return {affectedRows:1n,insertId:11n};}
    if(sql.startsWith("INSERT INTO command_executions")){if(this.failOn==="command")throw new Error("COMMAND_INSERT_FAILED");this.execution={event_id:values[0],command_code:values[1],execution_status:"completed",result_code:"reply_queued"};return {affectedRows:1n,insertId:12n};}
    if(sql.startsWith("INSERT INTO outbox_messages")){if(this.failOn==="outbox")throw new Error("OUTBOX_INSERT_FAILED");this.outbox={id:21n,destination_id:values[1],payload_json:values[2]};return {affectedRows:1n,insertId:21n};}
    if(sql.startsWith("UPDATE operations")){this.operation!.status="completed";this.operation!.result_json=values[0];return {affectedRows:1n,insertId:0n};}
    if(sql.startsWith("UPDATE canonical_app_wiring_operations SET claim_state='COMPLETED'")){
      if(this.failOn==="terminal")throw new Error("TERMINAL_UPDATE_FAILED");
      Object.assign(this.claim!,{claim_state:"COMPLETED",result_json:values[0],lease_token:null,lease_expires_time:null,error_code:null});return {affectedRows:1n,insertId:0n};
    }
    if(sql.startsWith("UPDATE canonical_app_wiring_operations SET claim_state='FAILED'")){Object.assign(this.claim!,{claim_state:"FAILED",error_code:values[0],lease_token:null,lease_expires_time:null});return {affectedRows:1n,insertId:0n};}
    return {affectedRows:0n,insertId:0n};
  }
}

async function provider(database:ReplyDatabase){
  const environment=await verifyStartupDatabaseIdentity(database,createEnvironmentContext({environmentCode:"dev",databaseIdentity:"hoi_bot"}));
  return new MariaAppWiringOperationProvider(database,environment,()=>"a1234567",1,()=>new Date("2026-09-04T00:00:00.000Z"),()=>"b".repeat(64));
}

describe("app-wiring READ_ONLY Iris reply atomic boundary",()=>{
  it("persists the query result, command execution, outbox and terminal claim together and replays the same outbox",async()=>{
    const database=new ReplyDatabase(),service=await provider(database);
    const prepared=await service.prepare({entrypointKind:"IRIS",externalRequestId:"event-1",normalizedPayload:{message:"/펫타이틀목록"},actor:"test"},()=>({route:"MODERN",effectMode:"READ_ONLY",reasonCode:"CANARY",handlerKey:"pet-title.list"}));
    if(prepared.replayed)throw new Error("unexpected replay");
    const result=await service.runReadOnlyReply(prepared,async(read)=>{
      const rows=await read.query<Array<{title_name:string}>>("SELECT title_name FROM canonical_pet_title_definitions");
      return {value:rows[0]!.title_name,reply:{eventId:"event-1",commandCode:"PET_TITLE_LIST_READ",destinationId:"room-1",data:"별빛"},receipt:{status:"REPLY_QUEUED",resultFingerprint:"c".repeat(64)}};
    });
    assert.deepEqual(result,{value:"별빛",reply:{outboxId:"21",room:"room-1",data:"별빛"}});
    assert.equal(database.claim?.claim_state,"COMPLETED");
    const replay=await service.prepare({entrypointKind:"IRIS",externalRequestId:"event-1",normalizedPayload:{message:"/펫타이틀목록"},actor:"test"},()=>{throw new Error("route re-resolved");});
    assert.equal(replay.replayed,true);
    assert.deepEqual(await service.replayReadOnlyReply(replay.claim),{outboxId:"21",room:"room-1",data:"별빛"});
  });

  it("rolls back every reply record when outbox persistence fails",async()=>{
    const database=new ReplyDatabase(),service=await provider(database);
    const prepared=await service.prepare({entrypointKind:"IRIS",externalRequestId:"event-2",normalizedPayload:{},actor:"test"},()=>({route:"MODERN",effectMode:"READ_ONLY",reasonCode:"CANARY",handlerKey:"pet-title.list"}));
    if(prepared.replayed)throw new Error("unexpected replay");
    database.failOn="outbox";
    await assert.rejects(()=>service.runReadOnlyReply(prepared,async()=>({value:"x",reply:{eventId:"event-2",commandCode:"PET_TITLE_LIST_READ",destinationId:"room-1",data:"x"},receipt:{status:"REPLY_QUEUED"}})),/OUTBOX_INSERT_FAILED/);
    assert.equal(database.operation,undefined);assert.equal(database.execution,undefined);assert.equal(database.outbox,undefined);assert.equal(database.claim?.claim_state,"CLAIMED");
  });

  it("keeps the handler query-only",async()=>{
    const database=new ReplyDatabase(),service=await provider(database);
    const prepared=await service.prepare({entrypointKind:"IRIS",externalRequestId:"event-3",normalizedPayload:{},actor:"test"},()=>({route:"MODERN",effectMode:"READ_ONLY",reasonCode:"CANARY",handlerKey:"pet-title.list"}));
    if(prepared.replayed)throw new Error("unexpected replay");
    await assert.rejects(()=>service.runReadOnlyReply(prepared,async(read)=>{await read.query("UPDATE canonical_pet_title_definitions SET title_name='x'");throw new Error("unreachable");}),/APP_WIRING_QUERY_NOT_READ_ONLY/);
  });

  it("reconciles an unknown commit from the exact persisted reply without rerunning the handler",async()=>{
    const database=new ReplyDatabase(),service=await provider(database);
    const prepared=await service.prepare({entrypointKind:"IRIS",externalRequestId:"event-4",normalizedPayload:{},actor:"test"},()=>({route:"MODERN",effectMode:"READ_ONLY",reasonCode:"CANARY",handlerKey:"pet-title.list"}));
    if(prepared.replayed)throw new Error("unexpected replay");
    database.throwAfterCommitOnce=true;
    let calls=0;
    const result=await service.runReadOnlyReply(prepared,async()=>{calls+=1;return {value:"별빛",reply:{eventId:"event-4",commandCode:"PET_TITLE_LIST_READ",destinationId:"room-1",data:"별빛"},receipt:{status:"REPLY_QUEUED",resultFingerprint:"d".repeat(64)}};});
    assert.equal(calls,1);
    assert.deepEqual(result.reply,{outboxId:"21",room:"room-1",data:"별빛"});
    assert.equal(database.claim?.claim_state,"COMPLETED");
  });

  it("fails closed when the persisted outbox payload drifts from the terminal receipt",async()=>{
    const database=new ReplyDatabase(),service=await provider(database);
    const prepared=await service.prepare({entrypointKind:"IRIS",externalRequestId:"event-5",normalizedPayload:{},actor:"test"},()=>({route:"MODERN",effectMode:"READ_ONLY",reasonCode:"CANARY",handlerKey:"pet-title.list"}));
    if(prepared.replayed)throw new Error("unexpected replay");
    await service.runReadOnlyReply(prepared,async()=>({value:"별빛",reply:{eventId:"event-5",commandCode:"PET_TITLE_LIST_READ",destinationId:"room-1",data:"별빛"},receipt:{status:"REPLY_QUEUED",resultFingerprint:"e".repeat(64)}}));
    database.outbox!.payload_json=JSON.stringify({data:"변조"});
    const replay=await service.prepare({entrypointKind:"IRIS",externalRequestId:"event-5",normalizedPayload:{},actor:"test"},()=>{throw new Error("route re-resolved");});
    assert.equal(replay.replayed,true);
    await assert.rejects(()=>service.replayReadOnlyReply(replay.claim),/APP_WIRING_REPLY_REPLAY_DRIFT/);
  });
});
