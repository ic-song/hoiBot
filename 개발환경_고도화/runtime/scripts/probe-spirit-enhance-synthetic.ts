import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { SpiritEnhanceService } from "../src/pet/spirit-enhance-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_spirit_enhance(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic spirit probe is blocked for database: ${config.database.name}`);
const base = process.env.SPIRIT_ENHANCE_PROBE_EVENT_ID ?? "spirit-enhance-g7-20260826-r1";
const restart = process.argv.includes("--verify-restart");
const database = createDatabaseClient(config.database);

async function event(id: string, user: string): Promise<void> {
  await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,'synthetic-spirit-room',?,'message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [id,id,user]);
}
async function player(id: number, identity: number, user: string, point: number, stone: number, grade = "수련생", level = 0): Promise<void> {
  await database.execute("INSERT INTO players(id,status) VALUES (?,'active')", [id]);
  await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (?,?,'kakao',?,'합성 사용자','linked')", [identity,id,user]);
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,'합성펫주인')", [id]);
  await database.execute("INSERT INTO player_pets(id,player_id,display_name) VALUES (?,?, '합성정령펫')", [id,id]);
  const policy=(await database.query<Array<{grade_code:string}>>("SELECT grade_code FROM elemental_enhancement_grades WHERE grade_display_name=?",[grade]))[0]!;
  await database.execute("INSERT INTO player_pet_elementals(player_pet_id,display_name,grade_code,grade_display_name,enhancement_level) VALUES (?,'정령의 알🪺',?,?,?)", [id,policy.grade_code,grade,level]);
  await database.execute("INSERT INTO currency_accounts(player_id,currency_code,balance) VALUES (?,'point',?)", [id,point]);
  const stoneId=(await database.query<Array<{id:bigint}>>("SELECT id FROM item_definitions WHERE code='ITEM-ELEMENTAL-UPGRADE-STONE'"))[0]!.id;
  if(stone>0) await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity) VALUES (?,?,?)",[id,stoneId,stone]);
}
function failAudit(inner: DatabaseClient): DatabaseClient {
  return { ping:()=>inner.ping(),query:(s,p)=>inner.query(s,p),execute:(s,p)=>inner.execute(s,p),verifyRollback:()=>inner.verifyRollback(),close:async()=>undefined,
    withTransaction:<T>(work:(t:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction((t)=>work({query:(s,p)=>t.query(s,p),execute:async(s,p)=>{if(s.includes("INSERT INTO command_audit"))throw new Error("synthetic spirit audit failure");return t.execute(s,p);}})) };
}
try {
  if (restart) {
    const service=new SpiritEnhanceService(database,()=>0);
    const before=await database.query<Array<{level:bigint;ops:bigint}>>("SELECT enhancement_level level,(SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.spirit_enhance:981000001' AND idempotency_key=?) ops FROM player_pet_elementals WHERE player_pet_id=981000001",[`${base}-success`]);
    await service.handleIris({externalUserId:"spirit-success",channelId:"synthetic-spirit-room",message:"/정령강화 2",eventId:`${base}-success`});
    const after=await database.query<Array<{level:bigint;ops:bigint}>>("SELECT enhancement_level level,(SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.spirit_enhance:981000001' AND idempotency_key=?) ops FROM player_pet_elementals WHERE player_pet_id=981000001",[`${base}-success`]);
    assert.deepEqual(after,before); assert.deepEqual(after[0],{level:2n,ops:1n});
    process.stdout.write(JSON.stringify({mode:"verify-restart",level:2,operationCount:1,additionalMutation:false,operationalDataTouched:false})+"\n");
  } else {
    await player(981000001,991000001,"spirit-success",1000000,10);
    await player(981000002,991000002,"spirit-empty",1000000,0);
    await player(981000003,991000003,"spirit-rollback",1000000,10);
    await event(`${base}-shadow`,"spirit-success");
    const shadow=await new SpiritEnhanceService(database,()=>0).handleIris({externalUserId:"spirit-success",channelId:"synthetic-spirit-room",message:"/정령강화",eventId:`${base}-shadow`}); assert.equal(shadow.status,"shadow");
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='SPIRIT_ENHANCE'");
    await event(`${base}-success`,"spirit-success"); await event(`${base}-empty`,"spirit-empty"); await event(`${base}-rollback`,"spirit-rollback");
    const service=new SpiritEnhanceService(database,()=>0);
    const success=await service.handleIris({externalUserId:"spirit-success",channelId:"synthetic-spirit-room",message:"/정령강화 2",eventId:`${base}-success`}); assert.equal(success.status,"changed");
    const replay=await service.handleIris({externalUserId:"spirit-success",channelId:"synthetic-spirit-room",message:"/정령강화 2",eventId:`${base}-success`}); assert.deepEqual(replay,success);
    const empty=await service.handleIris({externalUserId:"spirit-empty",channelId:"synthetic-spirit-room",message:"/정령강화",eventId:`${base}-empty`}); assert.equal(empty.status,"changed"); if(empty.status==="changed")assert.match(empty.data,/정령 강화석/);
    await assert.rejects(()=>new SpiritEnhanceService(failAudit(database),()=>0).enhance({playerId:"981000003",identityId:"991000003",destinationId:"synthetic-spirit-room",sourceEventId:`${base}-rollback`,idempotencyKey:`${base}-rollback`,count:1}),/synthetic spirit audit failure/);
    const effects=await database.query<Array<{level:bigint;point:string;stone:bigint;currencyLedger:bigint;inventoryLedger:bigint;rollbackLevel:bigint;rollbackOps:bigint}>>(`SELECT
      (SELECT enhancement_level FROM player_pet_elementals WHERE player_pet_id=981000001) level,
      (SELECT CAST(balance AS CHAR) FROM currency_accounts WHERE player_id=981000001 AND currency_code='point') point,
      (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=981000001 AND item.code='ITEM-ELEMENTAL-UPGRADE-STONE') stone,
      (SELECT COUNT(*) FROM currency_ledger WHERE player_id=981000001 AND reason_code='SPIRIT_ENHANCE') currencyLedger,
      (SELECT COUNT(*) FROM inventory_ledger WHERE player_id=981000001 AND reason_code='SPIRIT_ENHANCE_STONE') inventoryLedger,
      (SELECT enhancement_level FROM player_pet_elementals WHERE player_pet_id=981000003) rollbackLevel,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.spirit_enhance:981000003') rollbackOps`);
    assert.deepEqual(effects[0],{level:2n,point:"500000.000",stone:8n,currencyLedger:1n,inventoryLedger:1n,rollbackLevel:0n,rollbackOps:0n}); assert.equal(await database.verifyRollback(),true);
    process.stdout.write(JSON.stringify({mode:"probe",migrationCount:111,scenarios:["shadow","success-multi","replay","insufficient-stone","rollback"],effects:{level:2,point:500000,stone:8,currencyLedger:1,inventoryLedger:1,rollback:"0/0"},operationalDataTouched:false})+"\n");
  }
} finally { await database.close(); }
