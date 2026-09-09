import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaCommandDispatchRepository } from "../src/dispatch/command-dispatcher.js";
import { TrialTowerCommandService } from "../src/trial/trial-tower-command-service.js";

const config=loadConfig();if(!config.database.enabled||!/^hoibot_trial_tower(?:_[a-z0-9_]+)?$/i.test(config.database.name))throw new Error(`Blocked database: ${config.database.name}`);
const db=createDatabaseClient(config.database),base=process.env.TRIAL_TOWER_COMMAND_EVENT_ID??"trial-tower-command-g7-r1",room="synthetic-trial-room",external="synthetic-trial-user-command",restart=process.argv.includes("--verify-restart");
try{
  if(!restart){const player=await db.execute("INSERT INTO players(status) VALUES ('active')");
  await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,'합성시련자')",[player.insertId]);
  await db.execute("INSERT INTO player_pets(player_id,display_name,pet_type_code,experience,enhancement_level) VALUES (?,'합성펫','sky',10000,100)",[player.insertId]);
  await db.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'합성시련자','linked')",[player.insertId,external]);
  for(const eventId of[`${base}-shadow`,`${base}-active`])await db.execute("INSERT INTO event_inbox(event_id,event_kind,processing_status,received_at,provider_code,provider_event_id,external_channel_id,external_user_id,event_origin,direction,payload_hash,parse_status) VALUES (?,'message','processed',UTC_TIMESTAMP(3),'iris',?,?,?,'kakao','incoming',SHA2(?,256),'parsed') ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",[eventId,eventId,room,external,eventId]);}
  const dispatch=new MariaCommandDispatchRepository(db);assert.equal((await dispatch.findExact("/시련의탑"))?.handlerKey,"trial_tower");assert.equal(await dispatch.findExact("/시련의탑 1"),undefined);
  const service=new TrialTowerCommandService(db,()=>0);if(!restart){const shadow=await service.handleIris({eventId:`${base}-shadow`,channelId:room,externalUserId:external,message:"/시련의탑",recordDate:"2026-08-27"});assert.equal(shadow.status,"shadow");await db.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='TRIAL_TOWER'");}
  const input={eventId:`${base}-active`,channelId:room,externalUserId:external,message:"/시련의탑",recordDate:"2026-08-27"},first=await service.handleIris(input),replay=await service.handleIris(input);assert.equal(first.status,"changed");assert.deepEqual(replay,first);
  const counts=(await db.query<Array<{operations:bigint;attempts:bigint;rng:bigint;routes:bigint;outboxes:bigint;audits:bigint;executions:bigint}>>(`SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) operations,(SELECT COUNT(*) FROM trial_tower_attempts a JOIN operations o ON o.id=a.operation_id WHERE o.idempotency_key=?) attempts,(SELECT COUNT(*) FROM trial_tower_rng_samples r JOIN operations o ON o.id=r.operation_id WHERE o.idempotency_key=?) rng,(SELECT COUNT(*) FROM command_routing_decisions WHERE event_id IN (?,?)) routes,(SELECT COUNT(*) FROM outbox_messages m JOIN operations o ON o.id=m.operation_id WHERE o.idempotency_key=?) outboxes,(SELECT COUNT(*) FROM command_audit a JOIN operations o ON o.id=a.operation_id WHERE o.idempotency_key=?) audits,(SELECT COUNT(*) FROM command_executions WHERE event_id=?) executions`,[input.eventId,input.eventId,input.eventId,`${base}-shadow`,input.eventId,input.eventId,input.eventId,input.eventId]))[0]!;
  assert.deepEqual(Object.values(counts).map(Number),[1,1,6,2,1,1,1]);assert.equal(await db.verifyRollback(),true);
  console.log(JSON.stringify({mode:restart?"restart":"probe",status:first.status,counts},(_key,value)=>typeof value==="bigint"?value.toString():value));
}finally{await db.close();}
