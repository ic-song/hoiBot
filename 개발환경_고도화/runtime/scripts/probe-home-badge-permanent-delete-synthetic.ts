import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { HomeBadgePermanentDeleteService } from "../src/home/home-badge-permanent-delete-service.js";

const config=loadConfig();
if(!config.database.enabled||!/^hoibot_home_badge_permanent_delete(?:_[a-z0-9_]+)?$/i.test(config.database.name))throw new Error("isolated home badge permanent delete database required");
const database=createDatabaseClient(config.database);
try{
  const playerId=990000230n,externalUserId=`badge-delete-probe-${Date.now()}`,room="badge-delete-probe";
  await database.execute("INSERT INTO players(id,status) VALUES (?,'active')",[playerId]);
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name,tier_code) VALUES (?,'Probe 삭제자','king')",[playerId]);
  await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (?,?,'kakao',?,?,'linked')",[playerId,playerId,externalUserId,"Probe 삭제자"]);
  const version=(await database.query<Array<{id:bigint}>>("SELECT id FROM home_badge_definition_versions WHERE status='shadow' ORDER BY id DESC LIMIT 1"))[0]!.id;
  const badge=(await database.query<Array<{badge_code:string}>>("SELECT badge_code FROM home_badge_definitions WHERE definition_version_id=? ORDER BY ordinal LIMIT 1",[version]))[0]!.badge_code;
  await database.execute("INSERT INTO player_badge_assignments(player_id,badge_code,display_value,priority) VALUES (?,?,?,1)",[playerId,badge,badge]);
  await database.execute("INSERT INTO player_home_badges(player_id,badge_code,owned,equipped) VALUES (?,?,TRUE,FALSE)",[playerId,badge]);
  const eventId=`probe-delete-${Date.now()}`;
  await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3))",[eventId,eventId,room,externalUserId]);
  const service=new HomeBadgePermanentDeleteService(database);
  const result=await service.execute({eventId,externalUserId,destinationId:room,message:"/홈뱃지삭제 1"});
  const replay=await service.execute({eventId,externalUserId,destinationId:room,message:"/홈뱃지삭제 1"});
  assert.equal(result.badgeCode,badge); assert.equal(replay.replayed,true);
  assert.equal((await database.query<Array<{c:bigint}>>("SELECT COUNT(*) c FROM player_home_badge_exclusions WHERE player_id=? AND badge_code=?",[playerId,badge]))[0]!.c,1n);
  process.stdout.write(JSON.stringify({badge,resultCode:result.resultCode,replayed:replay.replayed})+"\n");
}finally{await database.close();}
