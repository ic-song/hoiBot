import assert from "node:assert/strict";
import { it } from "node:test";
import mariadb from "mariadb";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { MiniPetTitleLifecycleService } from "../src/mini-pet/title-lifecycle-service.js";

const enabled=process.env.HOIBOT_ISOLATED_MARIADB==="1";
it("adds, lists, removes, replays, and preserves mini-pet title invariants",{skip:!enabled},async()=>{
  const pool=mariadb.createPool({host:process.env.MARIADB_HOST!,port:Number(process.env.MARIADB_PORT),user:process.env.MARIADB_USER!,password:process.env.MARIADB_PASSWORD!,database:process.env.MARIADB_DATABASE!,connectionLimit:2,bigIntAsNumber:false});
  const database={async withTransaction<T>(work:(tx:DatabaseTransaction)=>Promise<T>):Promise<T>{const c=await pool.getConnection();try{await c.beginTransaction();const tx={query:async<R>(s:string,p?:unknown[])=>c.query(s,p)as Promise<R>,execute:async(s:string,p?:unknown[]):Promise<DatabaseWriteResult>=>{const r=await c.query(s,p)as{affectedRows?:number|bigint;insertId?:number|bigint};return{affectedRows:BigInt(r.affectedRows??0),insertId:BigInt(r.insertId??0)};}}as DatabaseTransaction;const result=await work(tx);await c.commit();return result;}catch(error){await c.rollback();throw error;}finally{c.release();}}}as DatabaseClient;
  try{
    const c=await pool.getConnection();try{
      await c.query("INSERT INTO players(id) VALUES(1),(2)");
      await c.query("INSERT INTO player_profiles(player_id,current_display_name) VALUES(1,'관리자회원'),(2,'대상회원')");
      await c.query("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,status) VALUES(91,1,'kakao','admin-user','linked'),(92,2,'kakao','target-user','linked')");
      await c.query("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES(7,'title-admin','타이틀관리자','fixture','active')");
      await c.query("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES(7,91)");
      await c.query("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT 7,id FROM admin_roles WHERE code='super_admin'");
      await c.query("INSERT INTO mini_pet_title_admin_channel_scopes(environment_code,external_channel_id,approved_by_operator_id) VALUES('dev','title-room',7)");
      await c.query("INSERT INTO mini_pet_projection_environment_identity(singleton_id,environment_code,database_identity) VALUES(1,'dev','00000000-0000-0000-0000-000000000060')");
      await c.query("INSERT INTO event_inbox(event_id,event_kind,processing_status,received_at) VALUES('add-1','message','processed',UTC_TIMESTAMP(3)),('add-2','message','processed',UTC_TIMESTAMP(3)),('remove-1','message','processed',UTC_TIMESTAMP(3)),('list-1','message','processed',UTC_TIMESTAMP(3))");
    }finally{c.release();}
    const service=new MiniPetTitleLifecycleService(database);
    const common={externalUserId:"admin-user",channelId:"title-room",environmentCode:"dev"as const};
    const first=await service.execute({...common,eventId:"add-1",message:"/미니펫타이틀추가 대상회원, 첫째"});
    await service.execute({...common,eventId:"add-2",message:"/미니펫타이틀추가 대상회원, 둘째"});
    const removed=await service.execute({...common,eventId:"remove-1",message:"/미니펫타이틀제거 대상회원, 1"});
    const replay=await service.execute({...common,eventId:"remove-1",message:"/미니펫타이틀제거 대상회원, 1"});
    const listed=await service.execute({externalUserId:"target-user",channelId:"title-room",environmentCode:"dev",eventId:"list-1",message:"/미니펫타이틀목록"});
    assert.equal(first.selectedStableOwnedTitleId,first.stableOwnedTitleId); assert.equal(removed.selectedStableOwnedTitleId,null); assert.equal(replay.replayed,true); assert.match(listed.data!,/1\. 둘째/); assert.doesNotMatch(listed.data!,/적용중/);
    const v=await pool.getConnection();try{
      const owned=await v.query<Array<{display_name:string;display_order:number;equipped:number}>>("SELECT definition.display_name,state.display_order,owned.equipped FROM mini_pet_title_owned_states state JOIN title_definitions definition ON definition.id=state.title_id JOIN player_titles owned ON owned.player_id=state.player_id AND owned.title_id=state.title_id WHERE state.player_id=2");
      const counts=await v.query<Array<{selections:bigint;events:bigint;operations:bigint;outbox:bigint}>>("SELECT (SELECT COUNT(*) FROM mini_pet_title_selections WHERE player_id=2) selections,(SELECT COUNT(*) FROM mini_pet_title_lifecycle_events) events,(SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'mini_pet.title_lifecycle:%') operations,(SELECT COUNT(*) FROM outbox_messages) outbox");
      assert.deepEqual(owned.map(row=>[row.display_name,row.display_order,Boolean(row.equipped)]),[["둘째",1,false]]);
      assert.deepEqual([Number(counts[0]!.selections),Number(counts[0]!.events),Number(counts[0]!.operations),Number(counts[0]!.outbox)],[0,3,4,4]);
    }finally{v.release();}
  }finally{await pool.end();}
});
