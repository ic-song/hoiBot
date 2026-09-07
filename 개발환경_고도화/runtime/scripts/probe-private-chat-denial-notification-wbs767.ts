import assert from "node:assert/strict";
import {buildApp} from "../src/app.js";
import {loadConfig} from "../src/config.js";
import {createDatabaseClient,type DatabaseClient} from "../src/database.js";
import {PrivateChatDenialNotificationService} from "../src/integration/private-chat-denial-notification-service.js";
import type {IrisKakaoDatabaseSnapshot} from "../src/integration/iris-kakao-database-inspector.js";
import {createEnvironmentContext,verifyStartupDatabaseIdentity} from "../src/runtime/environment-context.js";

const required=(name:string):string=>{const value=process.env[name];if(value===undefined||value==="")throw new Error(`${name} required`);return value;};
const databaseIdentity=required("DATABASE_NAME"),token=required("IRIS_SHARED_TOKEN"),privateRoomId="990000000000767",adminRoomId="wbs767-admin-room",externalUserId="wbs767-denied-user",fingerprint="7".repeat(64);
const open=()=>createDatabaseClient({enabled:true,host:required("DATABASE_HOST"),port:Number(required("DATABASE_PORT")),user:required("DATABASE_USER"),password:required("DATABASE_PASSWORD"),name:databaseIdentity,connectionLimit:6,connectTimeoutMs:5000});
const config=()=>loadConfig({NODE_ENV:"test",HOIBOT_ENVIRONMENT_CODE:"dev",IRIS_SHARED_TOKEN:token,USER_VERIFICATION_PEPPER:required("USER_VERIFICATION_PEPPER"),DATABASE_ENABLED:"true",DATABASE_HOST:required("DATABASE_HOST"),DATABASE_PORT:required("DATABASE_PORT"),DATABASE_USER:required("DATABASE_USER"),DATABASE_PASSWORD:required("DATABASE_PASSWORD"),DATABASE_NAME:databaseIdentity});
const snapshot: IrisKakaoDatabaseSnapshot={nickname:"거부자",nicknameSource:"open_chat_member",roomName:"WBS767 합성 개인방",roomNameSource:"chat_room_meta",db2IdentityTables:{rows:[]},chatLog:{rows:[]},targetChatLog:{rows:[]},chatRoom:{rows:[]},openChatMember:{rows:[]},friend:{rows:[]},openLink:{rows:[]}};
const send=(app:ReturnType<typeof buildApp>,id:string,message="/펫스킬정보")=>app.inject({method:"POST",url:`/api/v1/integrations/iris/events?token=${token}`,payload:{msg:message,room:snapshot.roomName,sender:"거부자",json:{_id:id,chat_id:privateRoomId,user_id:externalUserId}}});
const counts=(database:DatabaseClient)=>database.query<Array<{counter_count:bigint;attempt_count:bigint;notice_operation_count:bigint;notice_execution_count:bigint;audit_count:bigint;outbox_count:bigint}>>(`SELECT
  (SELECT attempt_count FROM private_chat_denial_counters WHERE environment_code='dev' AND database_identity=? AND provider_code='kakao' AND external_user_id=?) counter_count,
  (SELECT COUNT(*) FROM private_chat_denial_attempts) attempt_count,
  (SELECT COUNT(*) FROM operations WHERE idempotency_scope='private-chat-denial.notice') notice_operation_count,
  (SELECT COUNT(*) FROM command_executions WHERE command_code='PRIVATE_CHAT_DENIAL_NOTICE') notice_execution_count,
  (SELECT COUNT(*) FROM command_audit WHERE action_code='private_chat.denial.notice') audit_count,
  (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope='private-chat-denial.notice') outbox_count`,[databaseIdentity,externalUserId]);

async function application(database:DatabaseClient,skipFollowup=false){
  const environmentContext=await verifyStartupDatabaseIdentity(database,createEnvironmentContext({environmentCode:"dev",databaseIdentity}));
  return{environmentContext,app:buildApp(config(),{database,environmentContext,inspectIrisKakaoDatabase:async()=>snapshot,inspectIrisChannel:async()=>({mode:"denied",channelClass:"open_direct",reason:"open_direct_unverified",evidence:{roomType:"DirectChat",linkId:"wbs767-direct"}}),sendIrisTextReply:async()=>{throw new Error("WBS767_MUST_NOT_SEND_EXTERNALLY");},...(skipFollowup?{privateChatDenialNotificationService:{processEvent:async()=>({status:"ignored_v1" as const,replayed:true})}}:{})})};
}

async function main(){
  let database=open();process.env.PARTIAL_COMMAND_DISPATCH_ENABLED="true";
  try{
    if(process.argv.includes("--verify-restart")){
      const environmentContext=await verifyStartupDatabaseIdentity(database,createEnvironmentContext({environmentCode:"dev",databaseIdentity}));
      assert.equal(await new PrivateChatDenialNotificationService(database,environmentContext).reconcilePending(),0);
      const afterRestart=(await counts(database))[0]!;assert.deepEqual([afterRestart.counter_count,afterRestart.attempt_count,afterRestart.notice_operation_count,afterRestart.notice_execution_count,afterRestart.audit_count,afterRestart.outbox_count],[5n,5n,5n,5n,5n,1n]);
      console.log(`WBS767_RESTART_REPLAY_PASS count5=true pendingRecovery0=true outbox1=true port=${required("DATABASE_PORT")}`);return;
    }
    const player=await database.execute("INSERT INTO players(status,version) VALUES('active',1)");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES(?,'거부자',1)",[player.insertId]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES(?,'kakao',?,'거부자','linked')",[player.insertId,externalUserId]);
    await database.execute("INSERT INTO channels(provider_code,external_channel_id,channel_type,status) VALUES('kakao',?,'group','active')",[adminRoomId]);
    await database.execute("INSERT INTO private_chat_denial_notification_channels(private_chat_denial_notification_channel_id,environment_code,database_identity,provider_code,external_channel_id,delivery_enabled,configuration_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('chanw767','dev',?,'kakao',?,TRUE,?,'test:wbs767','2026-09-07 23:30:00','test:wbs767','2026-09-07 23:30:00')",[databaseIdentity,adminRoomId,fingerprint]);
    const roots=await application(database,true);try{
      for(const eventId of ["wbs767-1","wbs767-2"]){const response=await send(roots.app,eventId);assert.equal(response.statusCode,202,response.body);assert.equal(JSON.parse(response.body).ignored,true);}
    }finally{await roots.app.close();}
    const concurrentOne=open(),concurrentTwo=open();
    try{
      const contextOne=await verifyStartupDatabaseIdentity(concurrentOne,createEnvironmentContext({environmentCode:"dev",databaseIdentity}));
      const contextTwo=await verifyStartupDatabaseIdentity(concurrentTwo,createEnvironmentContext({environmentCode:"dev",databaseIdentity}));
      const concurrent=await Promise.all([
        new PrivateChatDenialNotificationService(concurrentOne,contextOne).processEvent("iris:wbs767-1"),
        new PrivateChatDenialNotificationService(concurrentTwo,contextTwo).processEvent("iris:wbs767-2")
      ]);
      assert.deepEqual(concurrent.map(result=>result.attemptOrdinal).sort(),["1","2"]);
    }finally{await concurrentOne.close();await concurrentTwo.close();}
    database=open();
    const first=await application(database);try{
      const third=await send(first.app,"wbs767-3");assert.equal(third.statusCode,202,third.body);assert.equal(JSON.parse(third.body).ignored,true);
      const beforeReplay=(await counts(database))[0]!;assert.deepEqual([beforeReplay.counter_count,beforeReplay.attempt_count,beforeReplay.notice_operation_count,beforeReplay.notice_execution_count,beforeReplay.audit_count,beforeReplay.outbox_count],[3n,3n,3n,3n,3n,1n]);
      const replay=await send(first.app,"wbs767-3");assert.equal(replay.statusCode,202,replay.body);const afterReplay=(await counts(database))[0]!;assert.deepEqual(afterReplay,beforeReplay);
      const outbox=(await database.query<Array<{destination_id:string;payload_json:string|{data:string}}>>("SELECT outbox.destination_id,outbox.payload_json FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope='private-chat-denial.notice'"))[0]!;
      const payload=typeof outbox.payload_json==="string"?JSON.parse(outbox.payload_json) as {data:string}:outbox.payload_json;
      assert.equal(outbox.destination_id,adminRoomId);assert.equal(payload.data,"[패스 미사용 1:1톡 감지]\n유저: 거부자\n개인톡방: WBS767 합성 개인방\n누적 횟수: 3회\n최근 메시지: /펫스킬정보");
    }finally{await first.app.close();}
    database=open();
    const gap=await application(database,true);try{const response=await send(gap.app,"wbs767-4");assert.equal(response.statusCode,202,response.body);}finally{await gap.app.close();}
    database=open();
    const beforeRecovery=(await counts(database))[0]!;assert.equal(beforeRecovery.counter_count,3n);assert.equal(beforeRecovery.attempt_count,3n);
    const recovered=await new PrivateChatDenialNotificationService(database,gap.environmentContext).reconcilePending();assert.equal(recovered,1);
    const afterRecovery=(await counts(database))[0]!;assert.deepEqual([afterRecovery.counter_count,afterRecovery.attempt_count,afterRecovery.notice_operation_count,afterRecovery.notice_execution_count,afterRecovery.audit_count,afterRecovery.outbox_count],[4n,4n,4n,4n,4n,1n]);
    const secondGap=await application(database,true);try{const response=await send(secondGap.app,"wbs767-5");assert.equal(response.statusCode,202,response.body);}finally{await secondGap.app.close();}
    database=open();
    const retryContext=await verifyStartupDatabaseIdentity(database,createEnvironmentContext({environmentCode:"dev",databaseIdentity}));
    const workerDatabase=open(),workerContext=await verifyStartupDatabaseIdentity(workerDatabase,createEnvironmentContext({environmentCode:"dev",databaseIdentity}));
    try{
      await database.withTransaction(async transaction=>{
        await transaction.query("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? FOR UPDATE",[externalUserId]);
        await assert.rejects(()=>new PrivateChatDenialNotificationService(workerDatabase,workerContext).processEvent("iris:wbs767-5"),/PRIVATE_CHAT_DENIAL_TRANSACTION_RETRY_EXHAUSTED/);
      });
      const afterExhaustion=(await counts(database))[0]!;assert.equal(afterExhaustion.counter_count,4n);assert.equal(afterExhaustion.attempt_count,4n);
      assert.equal(await new PrivateChatDenialNotificationService(database,retryContext).reconcilePending(),1);
      const final=(await counts(database))[0]!;assert.deepEqual([final.counter_count,final.attempt_count,final.notice_operation_count,final.notice_execution_count,final.audit_count,final.outbox_count],[5n,5n,5n,5n,5n,1n]);
      await database.execute("INSERT INTO private_chat_denial_counters(private_chat_denial_counter_id,environment_code,database_identity,provider_code,external_user_id,attempt_count,last_event_id,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('prodc767','prod',?,'kakao',?,9,'iris:wbs767-prod-proof','test:wbs767','2026-09-08 00:00:00','test:wbs767','2026-09-08 00:00:00')",[databaseIdentity,externalUserId]);
      const isolated=await database.query<Array<{environment_code:string;attempt_count:bigint}>>("SELECT environment_code,attempt_count FROM private_chat_denial_counters WHERE database_identity=? AND provider_code='kakao' AND external_user_id=? ORDER BY environment_code",[databaseIdentity,externalUserId]);
      assert.deepEqual(isolated,[{environment_code:"dev",attempt_count:5n},{environment_code:"prod",attempt_count:9n}]);
    }finally{await workerDatabase.close();}
    console.log(`WBS767_SYNTHETIC_PASS count5=true environmentIsolation=true concurrentOrdinal12=true replayIncrement0=true thirdOutbox1=true exactLegacyMessage=true crashGapRecovered=true retryExhaustionRollback=true externalSend0=true port=${required("DATABASE_PORT")}`);
  }finally{delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;try{await database.close();}catch(error){if(!(error instanceof Error)||!error.message.includes("pool is already closed"))throw error;}}
}
await main();
