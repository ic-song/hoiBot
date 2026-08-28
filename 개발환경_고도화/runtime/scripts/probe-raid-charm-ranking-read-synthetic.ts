import assert from "node:assert/strict";
import { createDatabaseClient,type DatabaseClient,type DatabaseTransaction } from "../src/database.js";
import { loadConfig } from "../src/config.js";
import { RaidCharmRankingReadService } from "../src/raid/raid-charm-ranking-read-service.js";

const config=loadConfig();
if(!config.database.enabled||!/^hoibot_raid_charm_ranking(?:_[a-z0-9_]+)?$/i.test(config.database.name))throw new Error("Raid charm ranking probe requires an isolated database.");
const database=createDatabaseClient(config.database);
const base="synthetic-raid-charm-ranking",viewer="synthetic-raid-viewer",room="synthetic-raid-room";

async function event(id:string){await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES(?,?,?,?,'message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3))",[id,id,room,viewer]);}
function failAudit(inner:DatabaseClient):DatabaseClient{return{ping:()=>inner.ping(),query:(s,p)=>inner.query(s,p),execute:(s,p)=>inner.execute(s,p),verifyRollback:()=>inner.verifyRollback(),close:async()=>undefined,withTransaction:<T>(work:(t:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction(t=>work({query:(s,p)=>t.query(s,p),execute:async(s,p)=>{if(s.includes("INSERT INTO command_audit"))throw new Error("synthetic raid ranking audit failure");return t.execute(s,p);}}))};}
async function effects(){return database.query<Array<{operations:bigint;snapshots:bigint;entries:bigint;outboxes:bigint;audits:bigint;executions:bigint;pet_version:bigint;guild_version:bigint}>>(`SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='raid.charm_ranking.read') operations,(SELECT COUNT(*) FROM raid_charm_rank_snapshots) snapshots,(SELECT COUNT(*) FROM raid_charm_rank_entries) entries,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope='raid.charm_ranking.read') outboxes,(SELECT COUNT(*) FROM command_audit WHERE action_code='raid.charm_ranking.read') audits,(SELECT COUNT(*) FROM command_executions WHERE command_code='RAID_CHARM_RANKING_READ') executions,(SELECT version FROM player_pets WHERE id=992300001) pet_version,(SELECT version FROM guilds WHERE id=992400001) guild_version`);}
async function seed(){
  await database.execute("INSERT INTO players(id,status,version) VALUES(992000001,'active',1),(992000002,'active',1),(992000003,'active',1),(992000004,'active',1)");
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES(992000001,'레이드왕'),(992000002,'동점앞'),(992000003,'동점뒤'),(992000004,'펫없음')");
  await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES(992200001,992000001,'kakao',?,'레이드왕','linked')",[viewer]);
  await database.execute("INSERT INTO player_pets(id,player_id,display_name,image_value,experience,version) VALUES(992300001,992000001,'왕펫','🐲',1000,3),(992300002,992000002,'앞펫','🐶',1000,1),(992300003,992000003,'뒤펫','🐱',1000,1)");
  await database.execute("INSERT INTO mini_pet_definitions(id,code,display_name,active) VALUES(992500001,'SYNTHETIC-RAID-MINI','레이드미니',TRUE)");
  await database.execute("INSERT INTO owned_mini_pets(id,player_id,mini_pet_definition_id,raid_experience,equipped) VALUES(992600001,992000001,992500001,200,TRUE)");
  await database.execute("INSERT INTO player_homes(player_id,display_name,base_experience,like_count,floor_area) VALUES(992000001,'레이드홈',300,0,10)");
  await database.execute("INSERT INTO guilds(id,code,display_name,status,version) VALUES(992400001,'SYNTHETIC-RAID-GUILD','레이드길드','active',4)");
  await database.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at) VALUES(992400001,992000001,'member',UTC_TIMESTAMP(3))");
  await database.execute("INSERT INTO guild_overall_charm_cube_options(guild_id,raid_units,castle_units,version) VALUES(992400001,50,0,2)");
  await database.execute("INSERT INTO player_home_badge_cubes(player_id,badge_code,raid_percent,equipped,version) VALUES(992000001,'SYNTHETIC-RAID-CUBE',10,TRUE,2)");
  await database.execute("INSERT INTO item_definitions(id,code,display_name,asset_type_code,stackable,active,version) VALUES(992700001,'SYNTHETIC-RAID-ITEM','청룡언월도','consumable',TRUE,TRUE,2)");
  await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES(992000001,992700001,1,2)");
}
async function probe(){
  await seed();assert.equal((await database.query<Array<{rollout_state:string}>>("SELECT rollout_state FROM command_registry WHERE command_code='RAID_CHARM_RANKING_READ'"))[0]?.rollout_state,"SHADOW");
  const service=new RaidCharmRankingReadService(database),success=`${base}-success`;await event(success);const first=await service.handle({eventId:success,externalUserId:viewer,channelId:room,message:"/레이드매력순위"});
  assert.equal(first?.rowCount,3);assert.match(first!.data,/왕펫/);assert.match(first!.data,/1,151,725/);assert.ok(first!.data.indexOf("앞펫")<first!.data.indexOf("뒤펫"));
  assert.deepEqual(await service.handle({eventId:success,externalUserId:viewer,channelId:room,message:"/레이드매력순위"}),{...first!,replayed:true});
  const concurrent=`${base}-concurrent`;await event(concurrent);const pair=await Promise.all([service.handle({eventId:concurrent,externalUserId:viewer,channelId:room,message:"/레이드매력순위"}),service.handle({eventId:concurrent,externalUserId:viewer,channelId:room,message:"/레이드매력순위"})]);assert.equal(pair[0]?.snapshotId,pair[1]?.snapshotId);assert.equal(pair[0]?.data,pair[1]?.data);assert.deepEqual(pair.map(result=>result?.replayed).sort(),[false,true]);
  const rollback=`${base}-rollback`;await event(rollback);const before=await effects();await assert.rejects(()=>new RaidCharmRankingReadService(failAudit(database)).handle({eventId:rollback,externalUserId:viewer,channelId:room,message:"/레이드매력순위"}),/synthetic raid ranking audit failure/);assert.deepEqual(await effects(),before);assert.equal(await database.verifyRollback(),true);
  assert.deepEqual((await effects())[0],{operations:2n,snapshots:2n,entries:6n,outboxes:2n,audits:2n,executions:2n,pet_version:3n,guild_version:4n});
  process.stdout.write(JSON.stringify({mode:"probe",migrationCount:277,scenarios:["shadow","exact","legacy-components","bigint","eligibility","deterministic-tie","snapshot","replay","concurrent-read","rollback"],effects:{operations:2,snapshots:2,entries:6,outboxes:2,audits:2,executions:2},domainMutation:false})+"\n");
}
async function restart(){const before=await effects(),result=await new RaidCharmRankingReadService(database).handle({eventId:`${base}-success`,externalUserId:viewer,channelId:room,message:"/레이드매력순위"});assert.equal(result?.replayed,true);assert.deepEqual(await effects(),before);process.stdout.write(JSON.stringify({mode:"verify-restart",replayStable:true,additionalMutation:false,domainMutation:false})+"\n");}
try{if(process.argv.includes("--verify-restart"))await restart();else await probe();}finally{await database.close();}
