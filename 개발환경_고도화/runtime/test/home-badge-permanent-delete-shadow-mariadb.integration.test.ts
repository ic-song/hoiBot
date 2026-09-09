import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { HomeBadgePermanentDeleteIrisHandler } from "../src/home/home-badge-permanent-delete-iris-handler.js";

const enabled=process.env.HOME_BADGE_PERMANENT_DELETE_SHADOW_TEST === "1";
test("홈뱃지 영구삭제 Shadow Iris 응답",{skip:!enabled},async()=>{
  const config=loadConfig(); assert.match(config.database.name,/^hoibot_home_badge_permanent_delete(?:_[a-z0-9_]+)?$/i);
  const database=createDatabaseClient(config.database),playerId=990000220n,externalUserId=`badge-delete-shadow-${Date.now()}`,room="isolated-badge-delete-shadow";
  try{
    await database.execute("INSERT INTO players(id,status) VALUES (?,'active')",[playerId]);
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,tier_code) VALUES (?,'Shadow 삭제자','king')",[playerId]);
    await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (?,?,'kakao',?,?,'linked')",[playerId,playerId,externalUserId,"Shadow 삭제자"]);
    const version=(await database.query<Array<{id:bigint}>>("SELECT id FROM home_badge_definition_versions WHERE status='shadow' ORDER BY id DESC LIMIT 1"))[0]!.id;
    const badge=(await database.query<Array<{badge_code:string}>>("SELECT badge_code FROM home_badge_definitions WHERE definition_version_id=? ORDER BY ordinal LIMIT 1",[version]))[0]!.badge_code;
    await database.execute("INSERT INTO player_badge_assignments(player_id,badge_code,display_value,priority) VALUES (?,?,?,1)",[playerId,badge,badge]);
    await database.execute("INSERT INTO player_home_badges(player_id,badge_code,owned,equipped) VALUES (?,?,TRUE,FALSE)",[playerId,badge]);
    const eventId=`shadow-delete-${Date.now()}`;
    await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3))",[eventId,eventId,room,externalUserId]);
    const response=await new HomeBadgePermanentDeleteIrisHandler(database).execute({eventId,providerEventId:eventId,providerCode:"iris",eventKind:"message",direction:"incoming",channelId:room,userId:externalUserId,displayName:"Shadow 삭제자",displayNameSource:"iris_cache",displayNameTrust:"trusted",message:"/홈뱃지삭제 1",eventCode:"message",eventCategory:"chat",monitoringGroup:"general" as never,eventMetadata:{},payloadHash:"7".repeat(64)});
    assert.equal(response.room,room); assert.match(response.message,/영구 삭제했습니다/);
    assert.equal((await database.query<Array<{c:bigint}>>("SELECT COUNT(*) c FROM player_home_badge_exclusions WHERE player_id=? AND badge_code=?",[playerId,badge]))[0]!.c,1n);
  }finally{await database.close();}
});
