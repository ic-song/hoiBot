import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaCommandDispatchRepository } from "../src/dispatch/command-dispatcher.js";
import { TrialTowerSyncService } from "../src/trial/trial-tower-sync-service.js";

const config=loadConfig();if(!config.database.enabled||!/^hoibot_trial_tower_sync(?:_[a-z0-9_]+)?$/i.test(config.database.name))throw new Error(`Blocked database: ${config.database.name}`);
const db=createDatabaseClient(config.database),base=process.env.TRIAL_TOWER_SYNC_EVENT_ID??"trial-tower-sync-g7-r1",room="synthetic-trial-sync-room",restart=process.argv.includes("--verify-restart");
try{
  let operatorId:bigint;
  if(!restart){const operator=await db.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,'호이 남','synthetic','active')",[`trial-sync-${base}`]);operatorId=operator.insertId;
    const active=await db.execute("INSERT INTO players(status) VALUES ('active')"),inactive=await db.execute("INSERT INTO players(status) VALUES ('inactive')");
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,'활성 회원'),(?,'탈퇴 회원')",[active.insertId,inactive.insertId]);
    await db.execute("INSERT INTO trial_tower_progress(season_key,player_id,floor) VALUES ('current',?,12),('current',?,77)",[active.insertId,inactive.insertId]);
    await db.execute("INSERT INTO event_inbox(event_id,event_kind,processing_status,received_at,provider_code,provider_event_id,external_channel_id,external_user_id,event_origin,direction,payload_hash,parse_status) VALUES (?,'message','processed',UTC_TIMESTAMP(3),'iris',?,?,?,'kakao','incoming',SHA2(?,256),'parsed')",[`${base}-active`,`${base}-active`,room,"trial-sync-owner",base]);
  }else{const state=(await db.query<Array<{id:bigint}>>("SELECT id FROM admin_operators WHERE login_id=?",[`trial-sync-${base}`]))[0]!;operatorId=state.id;}
  const dispatch=new MariaCommandDispatchRepository(db);assert.equal((await dispatch.findExact("/시련의탑동기화"))?.handlerKey,"trial_tower_sync");assert.equal(await dispatch.findExact("/시련의탑동기화 1"),undefined);
  const service=new TrialTowerSyncService(db),input={idempotencyKey:`${base}-active`,sourceEventId:`${base}-active`,destinationId:room,operatorId:operatorId.toString()};
  if(!restart)await db.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='ADMIN_TRIAL_TOWER_SYNC'");
  const first=await service.sync(input),replay=await service.sync(input);assert.deepEqual(replay,first);assert.equal(first.removedCount,1);assert.deepEqual(first.removedMemberKeys,["탈퇴 회원"]);
  const counts=(await db.query<Array<{operations:bigint;progress:bigint;removals:bigint;outboxes:bigint;audits:bigint;executions:bigint}>>(`SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) operations,(SELECT COUNT(*) FROM trial_tower_progress) progress,(SELECT COUNT(*) FROM trial_tower_sync_removals r JOIN operations o ON o.id=r.operation_id WHERE o.idempotency_key=?) removals,(SELECT COUNT(*) FROM outbox_messages m JOIN operations o ON o.id=m.operation_id WHERE o.idempotency_key=?) outboxes,(SELECT COUNT(*) FROM command_audit a JOIN operations o ON o.id=a.operation_id WHERE o.idempotency_key=?) audits,(SELECT COUNT(*) FROM command_executions WHERE event_id=?) executions`,[input.idempotencyKey,input.idempotencyKey,input.idempotencyKey,input.idempotencyKey,input.sourceEventId]))[0]!;
  assert.deepEqual(Object.values(counts).map(Number),[1,1,1,1,1,1]);assert.equal(await db.verifyRollback(),true);
  console.log(JSON.stringify({mode:restart?"restart":"probe",status:first.status,counts},(_key,value)=>typeof value==="bigint"?value.toString():value));
}finally{await db.close();}
