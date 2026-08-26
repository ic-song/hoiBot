import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaCommandDispatchRepository } from "../src/dispatch/command-dispatcher.js";
import { MatzangCommandService } from "../src/battle/matzang-command-service.js";

const config=loadConfig(); if(!config.database.enabled||!/^(hoibot_matzang_command_g7)$/i.test(config.database.name))throw new Error(`Blocked database: ${config.database.name}`);
const db=createDatabaseClient(config.database),restart=process.argv.includes("--verify-restart"),base=process.env.MATZZANG_COMMAND_EVENT_ID??`matzang-command-${randomUUID()}`,room="synthetic-matzang-room",a=970000001n,b=970000002n;
if(restart&&process.env.MATZZANG_COMMAND_EVENT_ID===undefined)throw new Error("MATZZANG_COMMAND_EVENT_ID is required");
try{
  await db.execute("INSERT INTO matzang_room_scopes(destination_id,active) VALUES (?,TRUE) ON DUPLICATE KEY UPDATE active=TRUE",[room]);
  await db.execute("INSERT IGNORE INTO players(id,status) VALUES (?,'active'),(?,'active')",[a,b]);
  await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,'합성알파'),(?,'합성베타') ON DUPLICATE KEY UPDATE current_display_name=VALUES(current_display_name)",[a,b]);
  await db.execute("UPDATE matzang_fields SET active=TRUE,resting=FALSE WHERE field_key='current'");
  await db.execute("INSERT INTO matzang_participants(field_key,player_id,display_name,total_exp,pet_type,upgrade_level,active,eliminated,match_count,pt,wins,losses,version) VALUES ('current',?,'합성알파',100,'하늘',1,TRUE,FALSE,0,0,0,0,1),('current',?,'합성베타',90,'땅',1,TRUE,FALSE,0,1,0,0,1) ON DUPLICATE KEY UPDATE active=TRUE,eliminated=FALSE,match_count=0,pt=VALUES(pt),total_exp=VALUES(total_exp),pet_type=VALUES(pet_type)",[a,b]);
  for(const eventId of [`${base}-wrong`,`${base}-battle`,`${base}-rank`])await db.execute("INSERT IGNORE INTO event_inbox(event_id,event_kind,processing_status,received_at,provider_code,provider_event_id,external_channel_id,external_user_id,event_origin,direction,payload_hash,parse_status) VALUES (?,'message','processed',UTC_TIMESTAMP(3),'iris',?,?,?,'kakao','incoming',SHA2(?,256),'parsed')",[eventId,eventId,room,a.toString(),eventId]);
  const dispatch=new MariaCommandDispatchRepository(db),battleDef=await dispatch.findExact("/맞짱"),aliasDef=await dispatch.findExact("ㅁㅁ"),rankDef=await dispatch.findExact("/맞짱순위"); assert.equal(battleDef?.handlerKey,"matzang_battle");assert.equal(aliasDef?.commandCode,"MATZZANG_BATTLE");assert.equal(rankDef?.handlerKey,"matzang_rank");assert.equal(await dispatch.findExact("/맞짱 1"),undefined);
  const service=new MatzangCommandService(db,()=>0),event=`${base}-battle`;
  if(!restart){const wrong=await service.handle({eventId:`${base}-wrong`,destinationId:"other-room",playerId:a.toString(),message:"/맞짱"});assert.equal(wrong.status,"wrong_room");const battle=await service.handle({eventId:event,destinationId:room,playerId:a.toString(),message:"/맞짱"});assert.equal(battle.status,"battle");const replay=await service.handle({eventId:event,destinationId:room,playerId:a.toString(),message:"ㅁㅁ"});assert.equal(replay.outboxId,battle.outboxId);const rank=await service.handle({eventId:`${base}-rank`,destinationId:room,playerId:a.toString(),message:"/맞짱순위"});assert.equal(rank.status,"rank");assert.match(rank.data,/합성알파/);}else{const replay=await service.handle({eventId:event,destinationId:room,playerId:a.toString(),message:"/맞짱"});assert.equal(replay.status,"battle");}
  const effects=(await db.query<Array<{operations:bigint;battles:bigint;executions:bigint}>>("SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_key LIKE ?) operations,(SELECT COUNT(*) FROM matzang_battles battle JOIN operations operation_row ON operation_row.id=battle.operation_id WHERE operation_row.idempotency_key=?) battles,(SELECT COUNT(*) FROM command_executions WHERE event_id LIKE ?) executions",[`${base}%`,event,`${base}%`]))[0]!;assert.equal(effects.battles,1n);
  process.stdout.write(`${JSON.stringify({mode:restart?"verify-restart":"probe",scenarios:["exact-dispatch","room-guard","battle","rank","replay","restart"],effects:{operations:effects.operations.toString(),battles:effects.battles.toString(),executions:effects.executions.toString()},operationalDataTouched:false})}\n`);
}finally{await db.close();}
