import assert from "node:assert/strict";
import { createDatabaseClient } from "../src/database.js";
import { AdminFullSyncService } from "../src/admin/admin-full-sync-service.js";

const required=(name:string):string=>{const value=process.env[name];if(!value)throw new Error(`${name} required`);return value};
const databaseName=required("DATABASE_NAME");if(!/^hoibot_(modernization|admin_full_sync_[a-z0-9_]+)$/i.test(databaseName))throw new Error(`refused database ${databaseName}`);
const db=createDatabaseClient({enabled:true,host:required("DATABASE_HOST"),port:Number(required("DATABASE_PORT")),user:required("DATABASE_USER"),password:required("DATABASE_PASSWORD"),name:databaseName,connectionLimit:5,connectTimeoutMs:5000});
const eventId="synthetic-admin-full-sync-restart-v2",externalUserId="synthetic-admin-full-sync-operator-v2",channelId="synthetic-admin-full-sync-room";
try{
 const prior=await db.query<Array<{id:bigint}>>(`SELECT id FROM operations WHERE source_code='ADMIN_FULL_SYNC' AND idempotency_key=?`,[eventId]);
 if(prior[0]){
  const before=Number((await db.query<Array<{n:bigint}>>(`SELECT COUNT(*) n FROM operations WHERE id=?`,[prior[0].id]))[0]!.n);
  assert.equal((await new AdminFullSyncService(db).handleIris({eventId,externalUserId,channelId,message:"/전체동기화"})).status,"changed");
  assert.equal(Number((await db.query<Array<{n:bigint}>>(`SELECT COUNT(*) n FROM operations WHERE id=?`,[prior[0].id]))[0]!.n),before);
  console.log(JSON.stringify({ok:true,mode:"restart-replay",operationId:String(prior[0].id)}));
 }else{
  const operator=await db.execute(`INSERT INTO admin_operators(login_id,display_name,password_hash,status)VALUES('synthetic-admin-full-sync-probe-v2','synthetic','x','active')`),identity=await db.execute(`INSERT INTO external_identities(provider_code,external_user_id,status)VALUES('kakao',?,'linked')`,[externalUserId]);
  await db.execute(`INSERT INTO admin_operator_external_identities(operator_id,external_identity_id)VALUES(?,?)`,[operator.insertId,identity.insertId]);await db.execute(`INSERT INTO admin_operator_permission_overrides(operator_id,permission_code,effect,granted_by,reason)VALUES(?,'admin.full_sync.execute','allow',?,'synthetic')`,[operator.insertId,operator.insertId]);
  const active=await db.execute(`INSERT INTO players(status)VALUES('active')`),stale=await db.execute(`INSERT INTO players(status)VALUES('inactive')`);await db.execute(`INSERT INTO player_profiles(player_id,current_display_name)VALUES(?,'synthetic active'),(?,'synthetic stale')`,[active.insertId,stale.insertId]);const guild=await db.execute(`INSERT INTO guilds(code,display_name)VALUES('SYNTHETIC_FULL_SYNC_V2','synthetic')`);await db.execute(`INSERT INTO guild_members(guild_id,player_id,role_code)VALUES(?,?,'master')`,[guild.insertId,active.insertId]);const pet=await db.execute(`INSERT INTO player_pets(player_id,display_name)VALUES(?,'synthetic')`,[stale.insertId]);await db.execute(`INSERT INTO trial_tower_seasons(season_key,active)VALUES('SYNTHETIC_FULL_SYNC_V2',1)`);await db.execute(`INSERT INTO trial_tower_progress(season_key,player_id,floor)VALUES('SYNTHETIC_FULL_SYNC_V2',?,9)`,[stale.insertId]);await db.execute(`INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,payload_hash,processing_status,received_at)VALUES(?,?,?,?,'message','x','processing',UTC_TIMESTAMP(3))`,[eventId,eventId,channelId,externalUserId]);await db.execute(`UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='ADMIN_FULL_SYNC'`);
  assert.equal((await new AdminFullSyncService(db).handleIris({eventId,externalUserId,channelId,message:"/전체동기화"})).status,"changed");assert.equal(Number((await db.query<Array<{n:bigint}>>(`SELECT COUNT(*) n FROM player_pets WHERE id=?`,[pet.insertId]))[0]!.n),0);console.log(JSON.stringify({ok:true,mode:"initial"}));
 }
}finally{await db.close()}

