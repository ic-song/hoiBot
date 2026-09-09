import assert from "node:assert/strict";
import {buildApp} from "../src/app.js";
import {loadConfig} from "../src/config.js";
import {createDatabaseClient,type DatabaseClient} from "../src/database.js";
import {createEnvironmentContext,verifyStartupDatabaseIdentity} from "../src/runtime/environment-context.js";

const required=(name:string):string=>{const value=process.env[name];if(value===undefined||value==="")throw new Error(`${name} required`);return value;};
const databaseIdentity=required("DATABASE_NAME"),token=required("IRIS_SHARED_TOKEN"),roomId="990000000000766",externalUserId="wbs766-denied-user";
const open=()=>createDatabaseClient({enabled:true,host:required("DATABASE_HOST"),port:Number(required("DATABASE_PORT")),user:required("DATABASE_USER"),password:required("DATABASE_PASSWORD"),name:databaseIdentity,connectionLimit:6,connectTimeoutMs:5000});
const config=()=>loadConfig({NODE_ENV:"test",HOIBOT_ENVIRONMENT_CODE:"dev",IRIS_SHARED_TOKEN:token,USER_VERIFICATION_PEPPER:required("USER_VERIFICATION_PEPPER"),DATABASE_ENABLED:"true",DATABASE_HOST:required("DATABASE_HOST"),DATABASE_PORT:required("DATABASE_PORT"),DATABASE_USER:required("DATABASE_USER"),DATABASE_PASSWORD:required("DATABASE_PASSWORD"),DATABASE_NAME:databaseIdentity});
const send=(app:ReturnType<typeof buildApp>,id:string)=>app.inject({method:"POST",url:`/api/v1/integrations/iris/events?token=${token}`,payload:{msg:"/펫스킬정보",room:"WBS766 합성 개인방",sender:"거부자",json:{_id:id,chat_id:roomId,user_id:externalUserId}}});
type ReceiptRow={app_wiring_operation_id:string;claim_state:string;claim_result_json:string|Record<string,unknown>|null;error_code:string|null;operation_id:bigint;operation_status:string;operation_result_json:string|Record<string,unknown>|null;execution_status:string;result_code:string|null;outbox_count:bigint};
const parse=(value:string|Record<string,unknown>)=>typeof value==="string"?JSON.parse(value)as Record<string,unknown>:value;
const rows=(database:DatabaseClient,eventId:string)=>database.query<ReceiptRow[]>(`SELECT claim.app_wiring_operation_id,claim.claim_state,claim.result_json claim_result_json,claim.error_code,operation.id operation_id,operation.status operation_status,operation.result_json operation_result_json,execution.execution_status,execution.result_code,(SELECT COUNT(*) FROM outbox_messages outbox WHERE outbox.operation_id=operation.id) outbox_count FROM canonical_app_wiring_operations claim JOIN operations operation ON operation.idempotency_scope='app-wiring.read-only-no-reply' AND operation.idempotency_key=claim.app_wiring_operation_id JOIN command_executions execution ON execution.operation_id=operation.id AND execution.command_code='PET_SKILL_INFO' WHERE claim.external_request_id=?`,[`iris:${eventId}`]);

async function application(database:DatabaseClient){
  const environmentContext=await verifyStartupDatabaseIdentity(database,createEnvironmentContext({environmentCode:"dev",databaseIdentity}));
  return buildApp(config(),{database,environmentContext,inspectIrisChannel:async()=>({mode:"denied",channelClass:"open_direct",reason:"open_direct_unverified",evidence:{roomType:"DirectChat",linkId:"wbs766-direct"}}),sendIrisTextReply:async()=>{throw new Error("WBS766_SHADOW_MUST_NOT_REPLY");}});
}

function assertDenied(row:ReceiptRow):void{
  assert.equal(row.claim_state,"COMPLETED");assert.equal(row.error_code,null);assert.equal(row.operation_status,"completed");assert.equal(row.execution_status,"completed");assert.equal(row.result_code,"ignored");assert.equal(row.outbox_count,0n);
  const claim=parse(row.claim_result_json!),operation=parse(row.operation_result_json!);assert.equal(claim.status,"SHADOW_DENIED");assert.equal(operation.status,"SHADOW_DENIED");
  const projection=operation.receiptProjection as {version:string;authorization:{mode:string;reasonCode:string};value:{status:string;reasonCode:string}};
  assert.equal(projection.version,"PET_SKILL_INFO_PRIVATE_DENIAL_RECEIPT_V1");assert.deepEqual(projection.authorization,{mode:"PRIVATE_DENIED",reasonCode:"PET_SKILL_INFO_PRIVATE_PASS_REQUIRED"});assert.deepEqual(projection.value,{status:"denied",reasonCode:"PET_SKILL_INFO_PRIVATE_PASS_REQUIRED"});
}

async function main(){
  let database=open();process.env.PARTIAL_COMMAND_DISPATCH_ENABLED="true";
  try{
    if(process.argv.includes("--verify-restart")){
      const app=await application(database);try{for(const id of ["wbs766-denied","wbs766-legacy-failed"]){const response=await send(app,id),body=JSON.parse(response.body);assert.equal(response.statusCode,202,response.body);assert.equal(body.ignored,true);assert.equal(body.ignoreReason,"PET_SKILL_INFO_PRIVATE_PASS_REQUIRED");assert.equal((await rows(database,id)).length,1);}assertDenied((await rows(database,"wbs766-denied"))[0]!);const legacy=(await rows(database,"wbs766-legacy-failed"))[0]!;assert.equal(legacy.claim_state,"FAILED");assert.equal(legacy.error_code,"PET_SKILL_INFO_PRIVATE_PASS_REQUIRED");assert.equal(legacy.operation_status,"failed");assert.equal(legacy.execution_status,"failed");assert.equal(legacy.result_code,"PET_SKILL_INFO_PRIVATE_PASS_REQUIRED");assert.equal(legacy.outbox_count,0n);}finally{await app.close();database=open();}
      console.log("WBS766_RESTART_REPLAY_PASS denied=COMPLETED ignored=true legacyFailedCompatible=true operation=1 execution=1 outbox=0");return;
    }
    const player=await database.execute("INSERT INTO players(status,version) VALUES('active',1)");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES(?,'거부자',1)",[player.insertId]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES(?,'kakao',?,'거부자','linked')",[player.insertId,externalUserId]);
    const app=await application(database);try{
      const first=await send(app,"wbs766-denied"),firstBody=JSON.parse(first.body);assert.equal(first.statusCode,202,first.body);assert.equal(firstBody.ignored,true);assert.equal(firstBody.ignoreReason,"PET_SKILL_INFO_PRIVATE_PASS_REQUIRED");assertDenied((await rows(database,"wbs766-denied"))[0]!);
      const replay=await send(app,"wbs766-denied"),replayBody=JSON.parse(replay.body);assert.equal(replay.statusCode,202,replay.body);assert.equal(replayBody.ignoreReason,firstBody.ignoreReason);assert.equal((await rows(database,"wbs766-denied")).length,1);
      const legacyFirst=await send(app,"wbs766-legacy-failed");assert.equal(legacyFirst.statusCode,202,legacyFirst.body);const legacy=(await rows(database,"wbs766-legacy-failed"))[0]!;
      const errorCode="PET_SKILL_INFO_PRIVATE_PASS_REQUIRED",failedResult=JSON.stringify({appWiringOperationId:legacy.app_wiring_operation_id,eventId:"iris:wbs766-legacy-failed",errorCode,status:"FAILED",delivery:"NO_REPLY"});
      await database.withTransaction(async transaction=>{await transaction.execute("UPDATE event_inbox SET processing_status='failed',error_code=?,processed_at=UTC_TIMESTAMP(3) WHERE event_id='iris:wbs766-legacy-failed'",[errorCode]);await transaction.execute("UPDATE canonical_app_wiring_operations SET claim_state='FAILED',result_json=NULL,error_code=?,lease_token=NULL,lease_expires_time=NULL,UPDATE_USER='test:wbs766-legacy',UPDATE_TIME='2026-09-07 22:30:00' WHERE app_wiring_operation_id=?",[errorCode,legacy.app_wiring_operation_id]);await transaction.execute("UPDATE operations SET status='failed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[failedResult,legacy.operation_id]);await transaction.execute("UPDATE command_executions SET execution_status='failed',result_code=?,completed_at=UTC_TIMESTAMP(3) WHERE operation_id=?",[errorCode,legacy.operation_id]);});
      const legacyReplay=await send(app,"wbs766-legacy-failed"),legacyBody=JSON.parse(legacyReplay.body);assert.equal(legacyReplay.statusCode,202,legacyReplay.body);assert.equal(legacyBody.ignored,true);assert.equal(legacyBody.ignoreReason,errorCode);assert.equal((await rows(database,"wbs766-legacy-failed")).length,1);
    }finally{await app.close();database=open();}
    console.log(`WBS766_SYNTHETIC_PASS deniedCompleted=true ignored=true replay=true legacyFailedCompatible=true outbox0=true port=${required("DATABASE_PORT")}`);
  }finally{delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;await database.close();}
}
await main();
