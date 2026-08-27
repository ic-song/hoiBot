import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { HomeFurnitureCarrotTransferService } from "../src/home/home-furniture-carrot-transfer-service.js";

const config=loadConfig();
if(!config.database.enabled)throw new Error("db required");
if(!/^hoibot_home_furniture_carrot(?:_[a-z0-9_]+)?$/i.test(config.database.name))throw new Error(`Synthetic home furniture carrot probe blocked: ${config.database.name}`);
let database=createDatabaseClient(config.database);
let service=new HomeFurnitureCarrotTransferService(database);
const senderId=199001n,recipientId=199002n,lowTierId=199003n,identityId=199001n;
const externalUser="probe-home-furniture-carrot-sender",room="probe-home-furniture-carrot-room",base=`probe-home-furniture-carrot-${Date.now()}`;

async function addEvent(eventId:string):Promise<void>{
  await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3))",[eventId,eventId,room,externalUser]);
}

async function state(carrotItemId:bigint,thermometerItemId:bigint){
  return (await database.query<Array<{sender_bag:bigint;recipient_bag:bigint;carrot:bigint;thermometer:bigint;carrot_lifetime:bigint;thermo_lifetime:bigint;trades:bigint;inventory_ledgers:bigint;furniture_ledgers:bigint;operations:bigint}>>(
    `SELECT
      (SELECT COUNT(*) FROM furniture_inventory_instances WHERE player_id=? AND status='bag') sender_bag,
      (SELECT COUNT(*) FROM furniture_inventory_instances WHERE player_id=? AND status='bag') recipient_bag,
      (SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=?) carrot,
      (SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=?) thermometer,
      (SELECT value FROM player_counters WHERE player_id=? AND counter_code='carrot' AND period_key='lifetime') carrot_lifetime,
      (SELECT value FROM player_counters WHERE player_id=? AND counter_code='thermo' AND period_key='lifetime') thermo_lifetime,
      (SELECT COUNT(*) FROM furniture_carrot_trades) trades,
      (SELECT COUNT(*) FROM inventory_ledger WHERE operation_id IN (SELECT operation_id FROM furniture_carrot_trades)) inventory_ledgers,
      (SELECT COUNT(*) FROM furniture_inventory_ledger WHERE operation_id IN (SELECT operation_id FROM furniture_carrot_trades)) furniture_ledgers,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='home.furniture_carrot_transfer') operations`,
    [senderId,recipientId,senderId,carrotItemId,recipientId,thermometerItemId,senderId,recipientId],
  ))[0]!;
}

try{
  await database.execute("INSERT INTO players(id,status) VALUES (?,'active'),(?,'active'),(?,'active')",[senderId,recipientId,lowTierId]);
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name,tier_code) VALUES (?,'가구 보내는 왕','king'),(?,'가구 받는 황제','emperor'),(?,'가구 받는 시민','citizen')",[senderId,recipientId,lowTierId]);
  await database.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (?,'👑',1),(?,'🏛️',2),(?,'',3)",[senderId,recipientId,lowTierId]);
  await database.execute("INSERT INTO external_identities(id,provider_code,external_user_id,player_id,display_name,status) VALUES (?,'kakao',?,?,?,'linked')",[identityId,externalUser,senderId,"가구 보내는 왕"]);
  const items=await database.query<Array<{id:bigint;code:string}>>("SELECT id,code FROM item_definitions WHERE code IN ('ITEM-RWD-044','pet_skill_carrot_thermometer') AND active=TRUE");
  const carrot=items.find((row)=>row.code==="ITEM-RWD-044")!;
  const thermometer=items.find((row)=>row.code==="pet_skill_carrot_thermometer")!;
  assert.ok(carrot&&thermometer);
  await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,30,1)",[senderId,carrot.id]);
  await database.execute("INSERT INTO furniture_definitions(code,display_name,charm_value,active) VALUES ('PROBE-CARROT-STABLE-A','같은가구',100,TRUE),('PROBE-CARROT-STABLE-B','같은가구',100,TRUE),('PROBE-CARROT-LOW','낮은가구',50,TRUE),('PROBE-CARROT-RECIPIENT','수신가구',1,TRUE)");
  const definitions=await database.query<Array<{id:bigint;code:string}>>("SELECT id,code FROM furniture_definitions WHERE code LIKE 'PROBE-CARROT-%' ORDER BY id");
  const stableA=definitions.find((row)=>row.code==="PROBE-CARROT-STABLE-A")!,stableB=definitions.find((row)=>row.code==="PROBE-CARROT-STABLE-B")!,low=definitions.find((row)=>row.code==="PROBE-CARROT-LOW")!,recipientFurniture=definitions.find((row)=>row.code==="PROBE-CARROT-RECIPIENT")!;
  await database.execute("INSERT INTO furniture_inventory_instances(player_id,furniture_definition_id,charm_snapshot,grade_display_name,status) VALUES (?,?,100,'S','bag'),(?,?,100,'S','bag'),(?,?,50,'A','bag'),(?,?,1,'C','bag')",[senderId,stableA.id,senderId,stableB.id,senderId,low.id,recipientId,recipientFurniture.id]);
  const stableFirst=(await database.query<Array<{id:bigint}>>("SELECT instance.id FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE instance.player_id=? AND instance.status='bag' ORDER BY instance.charm_snapshot DESC,definition.display_name,instance.id LIMIT 1",[senderId]))[0]!.id;
  assert.equal((await database.query<Array<{rollout_state:string}>>("SELECT rollout_state FROM command_registry WHERE command_code='HOME_FURNITURE_CARROT_TRANSFER'"))[0]!.rollout_state,"SHADOW");

  const tierEvent=`${base}-tier`;
  await addEvent(tierEvent);
  await assert.rejects(service.handle({eventId:tierEvent,externalUserId:externalUser,destinationId:room,message:"/가구당근 가구 받는 시민 1"}));
  assert.equal((await database.query<Array<{count:bigint}>>("SELECT COUNT(*) count FROM furniture_carrot_trades"))[0]!.count,0n);

  const successEvent=`${base}-success`;
  await addEvent(successEvent);
  const command="/가구당근 가구 받는 황제 1";
  const result=await service.handle({eventId:successEvent,externalUserId:externalUser,destinationId:room,message:command});
  const trade=(await database.query<Array<{furniture_instance_id:bigint;source_index:bigint;carrot_fee:bigint;thermometer_reward:bigint;source_version_before:bigint;source_version_after:bigint}>>("SELECT furniture_instance_id,source_index,carrot_fee,thermometer_reward,source_version_before,source_version_after FROM furniture_carrot_trades"))[0]!;
  assert.equal(trade.furniture_instance_id,stableFirst);
  assert.equal(trade.source_index,1n);
  assert.equal(trade.carrot_fee,10n);
  assert.equal(trade.thermometer_reward,2n);
  assert.equal(trade.source_version_after,trade.source_version_before+1n);
  assert.equal((await database.query<Array<{player_id:bigint}>>("SELECT player_id FROM furniture_inventory_instances WHERE id=?",[stableFirst]))[0]!.player_id,recipientId);
  const mutated=await state(carrot.id,thermometer.id);
  assert.deepEqual(mutated,{sender_bag:2n,recipient_bag:2n,carrot:20n,thermometer:2n,carrot_lifetime:1n,thermo_lifetime:2n,trades:1n,inventory_ledgers:2n,furniture_ledgers:2n,operations:1n});
  assert.deepEqual(await service.handle({eventId:successEvent,externalUserId:externalUser,destinationId:room,message:command}),result);
  assert.deepEqual(await state(carrot.id,thermometer.id),mutated);

  const rollbackEvent=`${base}-rollback`;
  await addEvent(rollbackEvent);
  await database.execute("CREATE TRIGGER probe_home_furniture_carrot_audit_fail BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced home furniture carrot rollback'");
  await assert.rejects(service.handle({eventId:rollbackEvent,externalUserId:externalUser,destinationId:room,message:"/가구당근 가구 받는 황제 1"}),/forced home furniture carrot rollback/);
  await database.execute("DROP TRIGGER probe_home_furniture_carrot_audit_fail");
  assert.deepEqual(await state(carrot.id,thermometer.id),mutated);
  assert.equal(await database.verifyRollback(),true);

  await database.close();
  database=createDatabaseClient(config.database);
  service=new HomeFurnitureCarrotTransferService(database);
  assert.deepEqual(await service.handle({eventId:successEvent,externalUserId:externalUser,destinationId:room,message:command}),result);
  assert.deepEqual(await state(carrot.id,thermometer.id),mutated);
  process.stdout.write(JSON.stringify({scenarios:["shadow-registry","atomic-transfer","tier-gate","stable-index","dual-inventory-ledger","furniture-ledger","lifetime-counters","idempotent-replay","rollback","restart-replay"],state:mutated},(_key,value)=>typeof value==="bigint"?value.toString():value)+"\n");
}finally{
  await database.execute("DROP TRIGGER IF EXISTS probe_home_furniture_carrot_audit_fail").catch(()=>undefined);
  await database.close();
}
