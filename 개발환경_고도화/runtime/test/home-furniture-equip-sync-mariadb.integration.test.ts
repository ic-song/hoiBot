import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { HomeFurnitureEquipSyncService } from "../src/home/home-furniture-equip-sync-service.js";

const enabled=process.env.DATABASE_INTEGRATION_ENABLED==="true";
const required=(name:string):string=>process.env[name]??"integration-not-configured";

describe("home furniture equip sync MariaDB integration",{skip:!enabled},()=>{
  let database:DatabaseClient;
  const token="home-furniture-sync-token",roomId="990000000000576",suffix=Date.now().toString(),operatorExternalId=`furniture-sync-admin-${suffix}`,guestExternalId=`furniture-sync-guest-${suffix}`;
  let homePlayerId="",orphanPlayerId="";
  before(async()=>{
    database=createDatabaseClient({enabled:true,host:required("DATABASE_HOST"),port:Number(required("DATABASE_PORT")),user:required("DATABASE_USER"),password:required("DATABASE_PASSWORD"),name:required("DATABASE_NAME"),connectionLimit:5,connectTimeoutMs:5_000});
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='HOME_FURNITURE_EQUIP_SYNC'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,?,'active')",[`furniture-sync-${suffix}`,"가구 동기화 관리자","synthetic"]);
    const operator=(await database.query<Array<{id:bigint}>>("SELECT id FROM admin_operators WHERE login_id=?",[`furniture-sync-${suffix}`]))[0]!;
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1),('active',1),('active',1),('active',1)");
    const players=await database.query<Array<{id:bigint}>>("SELECT id FROM players ORDER BY id DESC LIMIT 4");
    const guestPlayer=players[0]!,orphanPlayer=players[1]!,homePlayer=players[2]!,operatorPlayer=players[3]!;homePlayerId=homePlayer.id.toString();orphanPlayerId=orphanPlayer.id.toString();
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'가구 동기화 관리자','linked'),(?,'kakao',?,'일반 사용자','linked')",[operatorPlayer.id,operatorExternalId,guestPlayer.id,guestExternalId]);
    const identity=(await database.query<Array<{id:bigint}>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?",[operatorExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)",[operator.id,identity.id]);
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'합성 가구 유저',1)",[homePlayer.id]);
    await database.execute("INSERT INTO player_homes(player_id,display_name,base_experience,floor_area) VALUES (?,'합성 집',10,20)",[homePlayer.id]);
    await database.execute("INSERT INTO furniture_definitions(code,display_name,charm_value,active) VALUES (?,'합성 가구',100,TRUE)",[ `sync-furniture-${suffix}`]);
    const definition=(await database.query<Array<{id:bigint}>>("SELECT id FROM furniture_definitions WHERE code=?",[`sync-furniture-${suffix}`]))[0]!;
    await database.execute("INSERT INTO owned_furniture(player_id,furniture_definition_id,quantity) VALUES (?,?,2),(?,?,1)",[homePlayer.id,definition.id,orphanPlayer.id,definition.id]);
    const owned=(await database.query<Array<{id:bigint;player_id:bigint}>>("SELECT id,player_id FROM owned_furniture WHERE furniture_definition_id=? ORDER BY player_id",[definition.id]));
    const homeOwned=owned.find(row=>row.player_id.toString()===homePlayerId)!;
    await database.execute("INSERT INTO furniture_placements(player_id,owned_furniture_id,placement_key) VALUES (?,?,?)",[homePlayer.id,homeOwned.id,`legacy-placement-${suffix}`]);
    await database.execute("INSERT INTO furniture_inventory_instances(player_id,furniture_definition_id,charm_snapshot,grade_display_name,status,version) VALUES (?,?,100,'로열 루미에르','placed',1)",[homePlayer.id,definition.id]);
  });
  after(async()=>{if(!database)return;try{await database.execute("DROP TRIGGER IF EXISTS fail_home_furniture_sync_outbox");await database.close();}catch(error){const code=typeof error==="object"&&error!==null&&"code" in error?(error as{code?:unknown}).code:undefined;if(code!=="ER_POOL_ALREADY_CLOSED")throw error;}});
  it("imports legacy instances once, replays, blocks unauthorized/Shadow and rolls back",async()=>{
    const replies:Array<{room:string;data:string}>=[];
    const config=loadConfig({NODE_ENV:"test",IRIS_SHARED_TOKEN:token,USER_VERIFICATION_PEPPER:"home-furniture-sync-pepper",DATABASE_ENABLED:"true",DATABASE_HOST:required("DATABASE_HOST"),DATABASE_PORT:required("DATABASE_PORT"),DATABASE_USER:required("DATABASE_USER"),DATABASE_PASSWORD:required("DATABASE_PASSWORD"),DATABASE_NAME:required("DATABASE_NAME")});
    process.env.HOME_FURNITURE_EQUIP_SYNC_COMMAND_ENABLED="true";process.env.PARTIAL_COMMAND_DISPATCH_ENABLED="true";
    const app=buildApp(config,{database,inspectIrisChannel:async()=>({mode:"operational",channelClass:"open_group",reason:"allowed",evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}}),sendIrisTextReply:async reply=>{replies.push(reply);}});
    const eventId=`furniture-sync-${Date.now()}`,payload={msg:"/장착가구동기화",room:"고도화운영테스트방",sender:"가구 동기화 관리자",json:{_id:eventId,chat_id:roomId,user_id:operatorExternalId}};
    const active=await app.inject({method:"POST",url:`/api/v1/integrations/iris/events?token=${token}`,payload});assert.equal(active.statusCode,202,active.body);assert.match(replies.at(-1)?.data??"",/장착 가구 최초 분리 완료/);assert.match(replies.at(-1)?.data??"",/기존 목록 병합: 3개/);assert.match(replies.at(-1)?.data??"",/상세만 남은 유저: 1명/);
    const links=await database.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM home_furniture_legacy_instance_links");assert.equal(Number(links[0]!.count_value),3);
    const statuses=await database.query<Array<{status:string;count_value:bigint}>>("SELECT status,COUNT(*) count_value FROM furniture_inventory_instances WHERE player_id IN (?,?) GROUP BY status ORDER BY status",[homePlayerId,orphanPlayerId]);assert.deepEqual(statuses.map(row=>[row.status,Number(row.count_value)]),[["bag",2],["placed",2]]);
    const summary=(await database.query<Array<{placed_count:bigint;total_charm:string}>>("SELECT placed_count,CAST(total_charm AS CHAR) total_charm FROM home_furniture_sync_summaries WHERE player_id=?",[homePlayerId]))[0]!;assert.equal(Number(summary.placed_count),2);assert.equal(summary.total_charm,"200.000");
    await app.inject({method:"POST",url:`/api/v1/integrations/iris/events?token=${token}`,payload});const operations=await database.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM home_furniture_sync_operations");assert.equal(Number(operations[0]!.count_value),1);
    const service=new HomeFurnitureEquipSyncService(database);
    const prepareDirectEvent=async(eventId:string)=>database.execute(`INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?,'iris',?,'message','test','incoming',REPEAT('f',64),'parsed','processing',UTC_TIMESTAMP(3))`,[eventId,eventId]);
    const ongoingId=`direct:furniture-sync-ongoing-${Date.now()}`;await prepareDirectEvent(ongoingId);const ongoing=await service.execute({eventId:ongoingId,externalUserId:operatorExternalId,destinationId:roomId});assert.match(ongoing.reply,/장착 가구 상시 동기화 완료/);assert.match(ongoing.reply,/기존 목록 병합: 0개/);assert.match(ongoing.reply,/요약값 수정: 0명/);
    const guestId=`direct:furniture-sync-guest-${Date.now()}`;await prepareDirectEvent(guestId);await assert.rejects(()=>service.execute({eventId:guestId,externalUserId:guestExternalId,destinationId:roomId}),/권한이 없습니다/);
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='HOME_FURNITURE_EQUIP_SYNC'");const beforeShadow=Number((await database.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM home_furniture_sync_operations"))[0]!.count_value);await app.inject({method:"POST",url:`/api/v1/integrations/iris/events?token=${token}`,payload:{...payload,json:{...payload.json,_id:`furniture-sync-shadow-${Date.now()}`}}});const afterShadow=Number((await database.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM home_furniture_sync_operations"))[0]!.count_value);assert.equal(afterShadow,beforeShadow);
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='HOME_FURNITURE_EQUIP_SYNC'");await database.execute("CREATE TRIGGER fail_home_furniture_sync_outbox BEFORE INSERT ON outbox_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic outbox failure'");const rollbackId=`direct:furniture-sync-rollback-${Date.now()}`;await prepareDirectEvent(rollbackId);await assert.rejects(()=>service.execute({eventId:rollbackId,externalUserId:operatorExternalId,destinationId:roomId}),/synthetic outbox failure/);await database.execute("DROP TRIGGER fail_home_furniture_sync_outbox");const rollbackOp=await database.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM operations WHERE idempotency_scope='home.furniture_equip_sync' AND idempotency_key=?",[rollbackId]);assert.equal(Number(rollbackOp[0]!.count_value),0);
    delete process.env.HOME_FURNITURE_EQUIP_SYNC_COMMAND_ENABLED;await app.close();
  });
});
