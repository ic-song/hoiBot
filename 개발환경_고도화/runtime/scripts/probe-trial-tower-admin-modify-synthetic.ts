import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaCommandDispatchRepository } from "../src/dispatch/command-dispatcher.js";
import { TrialTowerAdminModifyService } from "../src/trial/trial-tower-admin-modify-service.js";

const config=loadConfig();if(!config.database.enabled||!/^hoibot_trial_tower_modify(?:_[a-z0-9_]+)?$/i.test(config.database.name))throw new Error(`Blocked database: ${config.database.name}`);
const db=createDatabaseClient(config.database),base=process.env.TRIAL_TOWER_MODIFY_EVENT_ID??"trial-tower-modify-g7-r1",room="synthetic-trial-modify-room",restart=process.argv.includes("--verify-restart");
try{
  let operatorId:bigint;
  if(!restart){const op=await db.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,'호이 남','synthetic','active')",[`trial-modify-${base}`]);operatorId=op.insertId;
    const player=await db.execute("INSERT INTO players(status) VALUES ('active')");await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,'합성 수정 회원')",[player.insertId]);await db.execute("INSERT INTO trial_tower_progress(season_key,player_id,floor) VALUES ('current',?,12)",[player.insertId]);
    await db.execute("INSERT INTO event_inbox(event_id,event_kind,processing_status,received_at,provider_code,provider_event_id,external_channel_id,external_user_id,event_origin,direction,payload_hash,parse_status) VALUES (?,'message','processed',UTC_TIMESTAMP(3),'iris',?,?,?,'kakao','incoming',SHA2(?,256),'parsed')",[`${base}-active`,`${base}-active`,room,"trial-modify-owner",base]);
  }else operatorId=(await db.query<Array<{id:bigint}>>("SELECT id FROM admin_operators WHERE login_id=?",[`trial-modify-${base}`]))[0]!.id;
  const dispatch=new MariaCommandDispatchRepository(db);assert.equal((await dispatch.findExact("/시련의탑수정 {닉네임} {층수}"))?.handlerKey,"trial_tower_admin_modify");assert.equal(await dispatch.findExact("/시련의탑수정 합성 수정 회원 77"),undefined);
  if(!restart)await db.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='ADMIN_TRIAL_TOWER_MODIFY'");
  const service=new TrialTowerAdminModifyService(db),input={message:"/시련의탑수정 합성 수정 회원 77",idempotencyKey:`${base}-active`,sourceEventId:`${base}-active`,destinationId:room,operatorId:operatorId.toString()},first=await service.modify(input),replay=await service.modify(input);assert.deepEqual(replay,first);assert.equal(first.status,"changed");
  const counts=(await db.query<Array<{operations:bigint;floor:bigint;adjustments:bigint;outboxes:bigint;audits:bigint;executions:bigint}>>(`SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) operations,(SELECT floor FROM trial_tower_progress p JOIN player_profiles profile ON profile.player_id=p.player_id WHERE profile.current_display_name='합성 수정 회원') floor,(SELECT COUNT(*) FROM trial_tower_progress_adjustments a JOIN operations o ON o.id=a.operation_id WHERE o.idempotency_key=?) adjustments,(SELECT COUNT(*) FROM outbox_messages m JOIN operations o ON o.id=m.operation_id WHERE o.idempotency_key=?) outboxes,(SELECT COUNT(*) FROM command_audit a JOIN operations o ON o.id=a.operation_id WHERE o.idempotency_key=?) audits,(SELECT COUNT(*) FROM command_executions WHERE event_id=?) executions`,[input.idempotencyKey,input.idempotencyKey,input.idempotencyKey,input.idempotencyKey,input.sourceEventId]))[0]!;
  assert.deepEqual(Object.values(counts).map(Number),[1,77,1,1,1,1]);assert.equal(await db.verifyRollback(),true);console.log(JSON.stringify({mode:restart?"restart":"probe",status:first.status,counts},(_k,v)=>typeof v==="bigint"?v.toString():v));
}finally{await db.close();}
