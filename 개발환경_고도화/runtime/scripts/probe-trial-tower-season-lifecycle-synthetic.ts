import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { IrisAdminCommandService } from "../src/admin/iris-admin-command-service.js";
import { MariaCommandDispatchRepository } from "../src/dispatch/command-dispatcher.js";
import { TrialTowerSeasonLifecycleService } from "../src/trial/trial-tower-season-lifecycle-service.js";

const config=loadConfig();if(!config.database.enabled||!/^hoibot_trial_tower_season(?:_[a-z0-9_]+)?$/i.test(config.database.name))throw new Error(`Blocked database: ${config.database.name}`);
const db=createDatabaseClient(config.database),base=process.env.TRIAL_TOWER_SEASON_EVENT_ID??"trial-tower-season-g7-r1",external="synthetic-trial-season-owner",rooms=["synthetic-season-a","synthetic-season-b"],restart=process.argv.includes("--verify-restart");
try{
  let operatorId:bigint;
  if(!restart){
    const operator=await db.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,'호이 남','synthetic','active')",[`trial-season-${base}`]);operatorId=operator.insertId;
    const player=await db.execute("INSERT INTO players(status) VALUES ('active')");await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,'호이 남')",[player.insertId]);
    await db.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'호이 남','linked')",[player.insertId,external]);
    const identity=(await db.query<Array<{id:bigint}>>("SELECT id FROM external_identities WHERE external_user_id=?",[external]))[0]!;
    await db.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)",[operatorId,identity.id]);
    for(const event of["shadow","end","start"])await db.execute("INSERT INTO event_inbox(event_id,event_kind,processing_status,received_at,provider_code,provider_event_id,external_channel_id,external_user_id,event_origin,direction,payload_hash,parse_status) VALUES (?,'message','processed',UTC_TIMESTAMP(3),'iris',?,?,?,'kakao','incoming',SHA2(?,256),'parsed')",[`${base}-${event}`,`${base}-${event}`,rooms[0],external,`${base}-${event}`]);
  }else operatorId=(await db.query<Array<{id:bigint}>>("SELECT id FROM admin_operators WHERE login_id=?",[`trial-season-${base}`]))[0]!.id;
  const dispatch=new MariaCommandDispatchRepository(db);assert.equal((await dispatch.findExact("/시련의탑시즌시작"))?.handlerKey,"trial_tower_season_lifecycle");assert.equal((await dispatch.findExact("/시련의탑시즌종료"))?.handlerKey,"trial_tower_season_lifecycle");assert.equal(await dispatch.findExact("/시련의탑시즌시작 해봐"),undefined);
  const endInput={message:"/시련의탑시즌종료",idempotencyKey:`${base}-end`,sourceEventId:`${base}-end`,operatorId:operatorId.toString()},startInput={message:"/시련의탑시즌시작",idempotencyKey:`${base}-start`,sourceEventId:`${base}-start`,operatorId:operatorId.toString()};
  let endResult,startResult;
  if(!restart){
    const admin=new IrisAdminCommandService(db,rooms),shadow=await admin.changePlayerPoint({externalUserId:external,channelId:rooms[0],message:"/시련의탑시즌종료",eventId:`${base}-shadow`});assert.equal(shadow.status,"shadow");
    assert.equal(Number((await db.query<Array<{active:number}>>("SELECT active FROM trial_tower_seasons WHERE season_key='current'"))[0]!.active),1);
    await db.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code IN ('ADMIN_TRIAL_TOWER_SEASON_START','ADMIN_TRIAL_TOWER_SEASON_END')");
    const ended=await admin.changePlayerPoint({externalUserId:external,channelId:rooms[0],message:endInput.message,eventId:endInput.sourceEventId});assert.equal(ended.status,"changed");
    const started=await admin.changePlayerPoint({externalUserId:external,channelId:rooms[0],message:startInput.message,eventId:startInput.sourceEventId});assert.equal(started.status,"changed");
    endResult=ended;startResult=started;
  }else{
    const service=new TrialTowerSeasonLifecycleService(db,rooms);endResult=await service.change(endInput);startResult=await service.change(startInput);
  }
  const replay=await new TrialTowerSeasonLifecycleService(db,rooms).change(startInput);assert.equal(replay.outboxId,startResult.outboxId);
  const counts=(await db.query<Array<{operations:bigint;transitions:bigint;outboxes:bigint;audits:bigint;executions:bigint;routes:bigint;active:bigint}>>(`SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_key IN (?,?)) operations,(SELECT COUNT(*) FROM trial_tower_season_transitions t JOIN operations o ON o.id=t.operation_id WHERE o.idempotency_key IN (?,?)) transitions,(SELECT COUNT(*) FROM outbox_messages m JOIN operations o ON o.id=m.operation_id WHERE o.idempotency_key IN (?,?)) outboxes,(SELECT COUNT(*) FROM command_audit a JOIN operations o ON o.id=a.operation_id WHERE o.idempotency_key IN (?,?)) audits,(SELECT COUNT(*) FROM command_executions WHERE event_id IN (?,?)) executions,(SELECT COUNT(*) FROM command_routing_decisions WHERE event_id IN (?,?,?)) routes,(SELECT active FROM trial_tower_seasons WHERE season_key='current') active`,[endInput.idempotencyKey,startInput.idempotencyKey,endInput.idempotencyKey,startInput.idempotencyKey,endInput.idempotencyKey,startInput.idempotencyKey,endInput.idempotencyKey,startInput.idempotencyKey,endInput.sourceEventId,startInput.sourceEventId,`${base}-shadow`,endInput.sourceEventId,startInput.sourceEventId]))[0]!;
  assert.deepEqual(Object.values(counts).map(Number),[2,2,4,2,2,3,1]);assert.equal(endResult.status,"changed");assert.equal(await db.verifyRollback(),true);
  console.log(JSON.stringify({mode:restart?"restart":"probe",counts},(_key,value)=>typeof value==="bigint"?value.toString():value));
}finally{await db.close();}
