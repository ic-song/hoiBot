import assert from "node:assert/strict";
import test from "node:test";
import { createDatabaseClient } from "../src/database.js";
import { AdminFullSyncService } from "../src/admin/admin-full-sync-service.js";

const required=(name:string):string=>{const value=process.env[name];if(!value)throw new Error(`${name} required`);return value};
const count=async(db:ReturnType<typeof createDatabaseClient>,sql:string,params:unknown[]=[]):Promise<number>=>Number((await db.query<Array<{n:bigint}>>(sql,params))[0]!.n);

test("전체동기화 MariaDB SHADOW, 5단계, replay, guild-first rollback",{skip:process.env.RUN_MARIADB_INTEGRATION!=="true"},async()=>{
 const db=createDatabaseClient({enabled:true,host:required("DATABASE_HOST"),port:Number(required("DATABASE_PORT")),user:required("DATABASE_USER"),password:required("DATABASE_PASSWORD"),name:required("DATABASE_NAME"),connectionLimit:5,connectTimeoutMs:5000});
 const suffix=String(Date.now()),externalUserId=`full-sync-${suffix}`,channelId=`room-${suffix}`,eventId=`event-${suffix}`,failureEventId=`failure-${suffix}`;
 try{
  const operator=await db.execute(`INSERT INTO admin_operators(login_id,display_name,password_hash,status)VALUES(?,'synthetic','x','active')`,[externalUserId]);
  const identity=await db.execute(`INSERT INTO external_identities(provider_code,external_user_id,status)VALUES('kakao',?,'linked')`,[externalUserId]);
  await db.execute(`INSERT INTO admin_operator_external_identities(operator_id,external_identity_id)VALUES(?,?)`,[operator.insertId,identity.insertId]);
  await db.execute(`INSERT INTO admin_operator_permission_overrides(operator_id,permission_code,effect,granted_by,reason)VALUES(?,'admin.full_sync.execute','allow',?,'synthetic')`,[operator.insertId,operator.insertId]);
  const active=await db.execute(`INSERT INTO players(status)VALUES('active')`),stale=await db.execute(`INSERT INTO players(status)VALUES('inactive')`);
  await db.execute(`INSERT INTO player_profiles(player_id,current_display_name)VALUES(?,?),(?,?)`,[active.insertId,`active-${suffix}`,stale.insertId,`stale-${suffix}`]);
  const guild=await db.execute(`INSERT INTO guilds(code,display_name)VALUES(?,?)`,[`G${suffix}`,`G${suffix}`]);
  await db.execute(`INSERT INTO guild_members(guild_id,player_id,role_code)VALUES(?,?,'member')`,[guild.insertId,active.insertId]);
  const pet=await db.execute(`INSERT INTO player_pets(player_id,display_name)VALUES(?,'synthetic')`,[stale.insertId]);
  const title=await db.execute(`INSERT INTO title_definitions(code,display_name,scope_code)VALUES(?,'synthetic','pet')`,[`T${suffix}`]);
  await db.execute(`INSERT INTO pet_titles(player_pet_id,title_id,equipped)VALUES(?,?,1)`,[pet.insertId,title.insertId]);
  await db.execute(`INSERT INTO trial_tower_seasons(season_key,active)VALUES(?,1)`,[`S${suffix}`]);
  await db.execute(`INSERT INTO trial_tower_progress(season_key,player_id,floor)VALUES(?,?,7)`,[`S${suffix}`,stale.insertId]);
  for(const event of[eventId,failureEventId])await db.execute(`INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,payload_hash,processing_status,received_at)VALUES(?,?,?,?,'message','x','processing',UTC_TIMESTAMP(3))`,[event,event,channelId,externalUserId]);
  await db.execute(`UPDATE command_registry SET rollout_state='SHADOW',enabled=1 WHERE command_code='ADMIN_FULL_SYNC'`);
  const service=new AdminFullSyncService(db),input={eventId,externalUserId,channelId,message:"/전체동기화"};
  assert.equal((await service.handleIris(input)).status,"shadow");assert.equal(await count(db,`SELECT COUNT(*) n FROM player_pets WHERE id=?`,[pet.insertId]),1);
  await db.execute(`UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='ADMIN_FULL_SYNC'`);
  const [first,concurrent]=await Promise.all([service.handleIris(input),service.handleIris(input)]);assert.equal(first.status,"changed");assert.deepEqual(concurrent,first);assert.equal(await count(db,`SELECT COUNT(*) n FROM player_pets WHERE id=?`,[pet.insertId]),0);assert.equal(await count(db,`SELECT COUNT(*) n FROM trial_tower_progress WHERE player_id=?`,[stale.insertId]),0);assert.equal(await count(db,`SELECT COUNT(*) n FROM admin_full_sync_phase_results p JOIN operations o ON o.id=p.operation_id WHERE o.idempotency_key=?`,[eventId]),5);assert.equal(await count(db,`SELECT COUNT(*) n FROM outbox_messages m JOIN operations o ON o.id=m.operation_id WHERE o.idempotency_key=?`,[eventId]),1);assert.equal(await count(db,`SELECT COUNT(*) n FROM command_audit a JOIN operations o ON o.id=a.operation_id WHERE o.idempotency_key=?`,[eventId]),1);
  const operations=await count(db,`SELECT COUNT(*) n FROM operations WHERE source_code='ADMIN_FULL_SYNC'`);assert.deepEqual(await service.handleIris(input),first);assert.equal(await count(db,`SELECT COUNT(*) n FROM operations WHERE source_code='ADMIN_FULL_SYNC'`),operations);
  const rollbackPlayer=await db.execute(`INSERT INTO players(status)VALUES('inactive')`);await db.execute(`INSERT INTO player_profiles(player_id,current_display_name)VALUES(?,'rollback')`,[rollbackPlayer.insertId]);const rollbackPet=await db.execute(`INSERT INTO player_pets(player_id,display_name)VALUES(?,'rollback')`,[rollbackPlayer.insertId]);
  await db.execute(`CREATE TRIGGER synthetic_full_sync_failure BEFORE INSERT ON guild_membership_reconciliation_runs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic guild failure'`);
  await assert.rejects(service.handleIris({...input,eventId:failureEventId}),/synthetic guild failure/);assert.equal(await count(db,`SELECT COUNT(*) n FROM player_pets WHERE id=?`,[rollbackPet.insertId]),1);assert.equal(await count(db,`SELECT COUNT(*) n FROM operations WHERE idempotency_key=?`,[failureEventId]),0);
 }finally{await db.execute(`DROP TRIGGER IF EXISTS synthetic_full_sync_failure`).catch(()=>undefined);await db.close()}
});


