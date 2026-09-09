import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient,type DatabaseClient,type DatabaseTransaction } from "../src/database.js";
import { HomeFurnitureEquipService } from "../src/home/home-furniture-equip-service.js";

const config=loadConfig();
if(!config.database.enabled||!/^hoibot_home_furniture_equip(?:_[a-z0-9_]+)?$/i.test(config.database.name))throw new Error("isolated home furniture equip database required");
let database=createDatabaseClient(config.database);
let service=()=>new HomeFurnitureEquipService(database);
const playerId=201001n,petId=201001n,externalUser="probe-home-furniture-equip",room="probe-home-furniture-equip-room",base=`probe-home-furniture-equip-${Date.now()}`;

async function addEvent(eventId:string):Promise<void>{
  await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('2',64),'processed',UTC_TIMESTAMP(3))",[eventId,eventId,room,externalUser]);
}

function failAudit(inner:DatabaseClient):DatabaseClient{
  return{
    ping:()=>inner.ping(),
    query:(sql,params)=>inner.query(sql,params),
    execute:(sql,params)=>inner.execute(sql,params),
    verifyRollback:()=>inner.verifyRollback(),
    close:async()=>undefined,
    withTransaction:<T>(work:(transaction:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction((transaction)=>work({
      query:(sql,params)=>transaction.query(sql,params),
      execute:async(sql,params)=>{if(sql.includes("INSERT INTO command_audit"))throw new Error("forced home furniture equip rollback");return transaction.execute(sql,params);},
    })),
  };
}

async function state(){
  return(await database.query<Array<{bag:bigint;placed:bigint;equip_operations:bigint;furniture_ledgers:bigint}>>(
    `SELECT
      (SELECT COUNT(*) FROM furniture_inventory_instances WHERE player_id=? AND status='bag') bag,
      (SELECT COUNT(*) FROM furniture_inventory_instances WHERE player_id=? AND status='placed') placed,
      (SELECT COUNT(*) FROM home_furniture_equip_operations WHERE player_id=?) equip_operations,
      (SELECT COUNT(*) FROM furniture_inventory_ledger WHERE operation_id IN (SELECT operation_id FROM home_furniture_equip_operations WHERE player_id=?)) furniture_ledgers`,
    [playerId,playerId,playerId,playerId],
  ))[0]!;
}

try{
  await database.execute("INSERT INTO players(id,status) VALUES (?,'active')",[playerId]);
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name,tier_code) VALUES (?,'가구 장착자','king')",[playerId]);
  await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (?,?,'kakao',?,?,'linked')",[playerId,playerId,externalUser,"가구 장착자"]);
  await database.execute("INSERT INTO player_homes(player_id,display_name,floor_area) VALUES (?,'장착 테스트 홈',9)",[playerId]);
  await database.execute("INSERT INTO player_pets(id,player_id,display_name) VALUES (?,?,'장착 보너스 펫')",[petId,playerId]);
  const bonusSkills=await database.query<Array<{id:bigint;code:string}>>("SELECT id,code FROM skill_definitions WHERE code IN ('pet_skill_building_owner','pet_skill_god_building_owner') ORDER BY id");
  assert.equal(bonusSkills.length,2);
  for(let index=0;index<bonusSkills.length;index++)await database.execute("INSERT INTO pet_skills(player_pet_id,slot_no,skill_id,level,equipped) VALUES (?,?,?,?,TRUE)",[petId,index+1,bonusSkills[index]!.id,1]);
  await database.execute("INSERT INTO player_passes(player_id,pass_code,enabled,permanent) VALUES (?,'premium',TRUE,TRUE)",[playerId]);
  await database.execute("INSERT INTO furniture_definitions(code,display_name,charm_value,active) VALUES ('PROBE-EQUIP-STABLE-A','같은가구',100,TRUE),('PROBE-EQUIP-STABLE-B','같은가구',100,TRUE),('PROBE-EQUIP-LOW','낮은가구',50,TRUE),('PROBE-EQUIP-PLACED-A','배치가구A',10,TRUE),('PROBE-EQUIP-PLACED-B','배치가구B',9,TRUE)");
  const definitions=await database.query<Array<{id:bigint;code:string}>>("SELECT id,code FROM furniture_definitions WHERE code LIKE 'PROBE-EQUIP-%' ORDER BY id");
  const definition=(code:string)=>definitions.find((row)=>row.code===code)!.id;
  await database.execute("INSERT INTO furniture_inventory_instances(player_id,furniture_definition_id,charm_snapshot,grade_display_name,status) VALUES (?,?,100,'S','bag'),(?,?,100,'S','bag'),(?,?,50,'A','bag'),(?,?,10,'B','placed'),(?,?,9,'B','placed')",[playerId,definition("PROBE-EQUIP-STABLE-A"),playerId,definition("PROBE-EQUIP-STABLE-B"),playerId,definition("PROBE-EQUIP-LOW"),playerId,definition("PROBE-EQUIP-PLACED-A"),playerId,definition("PROBE-EQUIP-PLACED-B")]);
  const stableFirst=(await database.query<Array<{id:bigint}>>("SELECT instance.id FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE instance.player_id=? AND instance.status='bag' ORDER BY instance.charm_snapshot DESC,definition.display_name,instance.id LIMIT 1",[playerId]))[0]!.id;
  assert.equal((await database.query<Array<{rollout_state:string}>>("SELECT rollout_state FROM command_registry WHERE command_code='HOME_FURNITURE_EQUIP'"))[0]!.rollout_state,"SHADOW");

  const usageEvent=`${base}-usage`;
  await addEvent(usageEvent);
  const usage=await service().handle({eventId:usageEvent,externalUserId:externalUser,destinationId:room,message:"/가구장착"});
  assert.equal(usage.status,"rejected");
  assert.match(usage.reply,/사용법/);
  const invalidEvent=`${base}-invalid`;
  await addEvent(invalidEvent);
  const invalid=await service().handle({eventId:invalidEvent,externalUserId:externalUser,destinationId:room,message:"/가구장착 99"});
  assert.equal(invalid.status,"rejected");
  assert.deepEqual(await state(),{bag:3n,placed:2n,equip_operations:0n,furniture_ledgers:0n});

  const fullEvent=`${base}-full`;
  await database.execute("UPDATE pet_skills SET equipped=FALSE WHERE player_pet_id=?",[petId]);
  await database.execute("UPDATE player_passes SET enabled=FALSE WHERE player_id=? AND pass_code='premium'",[playerId]);
  await addEvent(fullEvent);
  const full=await service().handle({eventId:fullEvent,externalUserId:externalUser,destinationId:room,message:"/가구장착 1"});
  assert.equal(full.status,"rejected");
  assert.match(full.reply,/배치 가능한 가구 수/);
  assert.deepEqual(await state(),{bag:3n,placed:2n,equip_operations:0n,furniture_ledgers:0n});

  await database.execute("UPDATE player_homes SET floor_area=100,version=version+1 WHERE player_id=?",[playerId]);
  await database.execute("UPDATE pet_skills SET equipped=TRUE WHERE player_pet_id=?",[petId]);
  await database.execute("UPDATE player_passes SET enabled=TRUE WHERE player_id=? AND pass_code='premium'",[playerId]);
  const successEvent=`${base}-success`;
  await addEvent(successEvent);
  const result=await service().handle({eventId:successEvent,externalUserId:externalUser,destinationId:room,message:"/가구장착 1"});
  assert.equal(result.status,"equipped");
  const operation=(await database.query<Array<{furniture_instance_id:bigint;requested_index:bigint;slot_limit:bigint;placed_count_before:bigint;placed_count_after:bigint}>>("SELECT furniture_instance_id,requested_index,slot_limit,placed_count_before,placed_count_after FROM home_furniture_equip_operations"))[0]!;
  assert.equal(operation.furniture_instance_id,stableFirst);
  assert.equal(operation.requested_index,1n);
  assert.equal(operation.slot_limit,34n);
  assert.equal(operation.placed_count_after,operation.placed_count_before+1n);
  const mutated={bag:2n,placed:3n,equip_operations:1n,furniture_ledgers:1n};
  assert.deepEqual(await state(),mutated);
  assert.deepEqual(await service().handle({eventId:successEvent,externalUserId:externalUser,destinationId:room,message:"/가구장착 1"}),result);
  assert.deepEqual(await state(),mutated);

  const rollbackEvent=`${base}-rollback`;
  await addEvent(rollbackEvent);
  const rollbackService=new HomeFurnitureEquipService(failAudit(database));
  await assert.rejects(rollbackService.handle({eventId:rollbackEvent,externalUserId:externalUser,destinationId:room,message:"/가구장착 1"}),/forced home furniture equip rollback/);
  assert.deepEqual(await state(),mutated);
  assert.equal(await database.verifyRollback(),true);

  await database.close();
  database=createDatabaseClient(config.database);
  assert.deepEqual(await service().handle({eventId:successEvent,externalUserId:externalUser,destinationId:room,message:"/가구장착 1"}),result);
  assert.deepEqual(await state(),mutated);
  process.stdout.write(JSON.stringify({scenarios:["shadow-registry","usage","invalid-index","small-floor-slot-full","stable-instance","large-floor-policy","exclusive-owner-bonus","premium-bonus","idempotent-replay","rollback-and-restart"],state:mutated},(_key,value)=>typeof value==="bigint"?value.toString():value)+"\n");
}finally{
  await database.close();
}
