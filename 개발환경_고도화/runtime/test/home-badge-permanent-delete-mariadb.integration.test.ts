import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { HomeBadgePermanentDeleteService } from "../src/home/home-badge-permanent-delete-service.js";

const enabled = process.env.HOME_BADGE_PERMANENT_DELETE_MARIADB_TEST === "1";

test("홈뱃지 영구삭제 MariaDB tombstone·rollback·멱등·재시작", { skip: !enabled }, async () => {
  const config = loadConfig();
  assert.match(config.database.name, /^hoibot_home_badge_permanent_delete(?:_[a-z0-9_]+)?$/i);
  let database = createDatabaseClient(config.database);
  const playerId = 990000210n, externalUserId = `badge-delete-${Date.now()}`, room = "isolated-home-badge-delete";
  const service = () => new HomeBadgePermanentDeleteService(database);
  const addEvent = async (eventId: string): Promise<void> => {
    await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('6',64),'processed',UTC_TIMESTAMP(3))", [eventId,eventId,room,externalUserId]);
  };
  const failAudit = (inner: DatabaseClient): DatabaseClient => ({
    ping:()=>inner.ping(),query:(sql,params)=>inner.query(sql,params),execute:(sql,params)=>inner.execute(sql,params),verifyRollback:()=>inner.verifyRollback(),close:async()=>undefined,
    withTransaction:<T>(work:(tx:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction((tx)=>work({
      query:(sql,params)=>tx.query(sql,params),execute:async(sql,params)=>{if(sql.includes("INSERT INTO command_audit"))throw new Error("forced badge delete rollback");return tx.execute(sql,params);}
    }))
  });
  try {
    await database.execute("INSERT INTO players(id,status) VALUES (?,'active')",[playerId]);
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,tier_code) VALUES (?,'뱃지 삭제자','king')",[playerId]);
    await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (?,?,'kakao',?,?,'linked')",[playerId,playerId,externalUserId,"뱃지 삭제자"]);
    const version=(await database.query<Array<{id:bigint}>>("SELECT id FROM home_badge_definition_versions WHERE status='shadow' ORDER BY id DESC LIMIT 1"))[0]!.id;
    const badges=await database.query<Array<{badge_code:string}>>("SELECT badge_code FROM home_badge_definitions WHERE definition_version_id=? ORDER BY ordinal LIMIT 2",[version]);
    const first=badges[0]!.badge_code,second=badges[1]!.badge_code;
    await database.execute("INSERT INTO player_badge_assignments(player_id,badge_code,display_value,priority) VALUES (?,?,?,1),(?,?,?,2)",[playerId,first,first,playerId,second,second]);
    await database.execute("INSERT INTO player_home_badges(player_id,badge_code,owned,equipped) VALUES (?,?,TRUE,TRUE),(?,?,TRUE,FALSE)",[playerId,first,playerId,second]);
    await database.execute("INSERT INTO player_home_badge_cubes(player_id,badge_code,castle_percent,raid_percent,pet_upgrade_percent,explore_percent,equipped) VALUES (?,?,11,12,13,14,TRUE),(?,?,21,22,23,24,FALSE)",[playerId,first,playerId,second]);
    await database.execute("INSERT INTO player_badge_equipment(player_id,equipped_badge_code,version) VALUES (?,?,1)",[playerId,first]);
    assert.equal((await database.query<Array<{rollout_state:string}>>("SELECT rollout_state FROM command_registry WHERE command_code='HOME_BADGE_PERMANENT_DELETE'"))[0]!.rollout_state,"SHADOW");

    const event=`delete-${Date.now()}`; await addEvent(event);
    const [a,b]=await Promise.all([
      service().execute({eventId:event,externalUserId,destinationId:room,message:"/홈뱃지삭제 01"}),
      service().execute({eventId:event,externalUserId,destinationId:room,message:"/홈뱃지삭제 01"})
    ]);
    assert.deepEqual([a.replayed,b.replayed].sort(),[false,true]);
    assert.equal(a.badgeCode,first); assert.equal(a.ordinal,1);
    assert.equal((await database.query<Array<{c:bigint}>>("SELECT COUNT(*) c FROM player_badge_assignments WHERE player_id=? AND badge_code=?",[playerId,first]))[0]!.c,0n);
    assert.equal((await database.query<Array<{c:bigint}>>("SELECT COUNT(*) c FROM player_home_badge_exclusions WHERE player_id=? AND badge_code=? AND reason_code='user_permanent_delete'",[playerId,first]))[0]!.c,1n);
    assert.equal((await database.query<Array<{c:bigint}>>("SELECT COUNT(*) c FROM player_home_badge_cubes WHERE player_id=? AND badge_code=?",[playerId,first]))[0]!.c,0n);
    assert.equal((await database.query<Array<{equipped_badge_code:string|null}>>("SELECT equipped_badge_code FROM player_badge_equipment WHERE player_id=?",[playerId]))[0]!.equipped_badge_code,null);

    const invalidEvent=`invalid-${Date.now()}`; await addEvent(invalidEvent);
    const invalid=await service().execute({eventId:invalidEvent,externalUserId,destinationId:room,message:`/홈뱃지삭제 ${first}`});
    assert.equal(invalid.resultCode,"not_owned_or_deleted");
    const rollbackEvent=`rollback-${Date.now()}`; await addEvent(rollbackEvent);
    await assert.rejects(new HomeBadgePermanentDeleteService(failAudit(database)).execute({eventId:rollbackEvent,externalUserId,destinationId:room,message:`/홈뱃지삭제 ${second}`}),/forced badge delete rollback/);
    assert.equal((await database.query<Array<{c:bigint}>>("SELECT COUNT(*) c FROM player_badge_assignments WHERE player_id=? AND badge_code=?",[playerId,second]))[0]!.c,1n);
    assert.equal((await database.query<Array<{c:bigint}>>("SELECT COUNT(*) c FROM player_home_badge_exclusions WHERE player_id=? AND badge_code=?",[playerId,second]))[0]!.c,0n);
    assert.equal(await database.verifyRollback(),true);
    await database.close(); database=createDatabaseClient(config.database);
    const replay=await service().execute({eventId:event,externalUserId,destinationId:room,message:"/홈뱃지삭제 01"});
    assert.equal(replay.replayed,true); assert.equal(replay.outboxId,a.outboxId);
  } finally { await database.close(); }
});
