import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { CastleBattleExecuteService } from "../src/castle/castle-battle-execute-service.js";

const config = loadConfig();
if (!config.database.enabled || config.database.name !== "hoibot_castle_battle_execute_g7") throw new Error(`Blocked database: ${config.database.name}`);
const base = process.env.CASTLE_BATTLE_EVENT_ID ?? "castle-battle-fixed";
const restart = process.argv.includes("--verify-restart");
const database = createDatabaseClient(config.database);
const service = new CastleBattleExecuteService(database);

async function event(id: string): Promise<void> {
  await database.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,'synthetic-castle-room','castle-attacker','message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",
    [id,id]
  );
}

async function battle(id: string) {
  return service.handle({ externalUserId:"castle-attacker",channelId:"synthetic-castle-room",message:"/캐슬대전",eventId:id,mode:"direct" });
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping:()=>inner.ping(),query:(sql,params)=>inner.query(sql,params),execute:(sql,params)=>inner.execute(sql,params),
    verifyRollback:()=>inner.verifyRollback(),close:async()=>undefined,
    withTransaction:<T>(work:(transaction:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction(transaction=>work({
      query:(sql,params)=>transaction.query(sql,params),execute:async(sql,params)=>{
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic castle battle audit failure");
        return transaction.execute(sql,params);
      }
    }))
  };
}

async function snapshot() {
  return (await database.query<Array<{ operations:bigint;settlements:bigint;outboxes:bigint;audits:bigint;attempts:string;points:string;tickets:string }>>(`
    SELECT
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'castle.battle.execute:%') operations,
      (SELECT COUNT(*) FROM castle_battle_settlements) settlements,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope LIKE 'castle.battle.execute:%') outboxes,
      (SELECT COUNT(*) FROM command_audit WHERE action_code='castle.battle.execute') audits,
      (SELECT CAST(castle_battle_attempts AS CHAR) FROM player_pet_daily_records WHERE player_id=988600001 AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))) attempts,
      (SELECT CAST(balance AS CHAR) FROM currency_accounts WHERE player_id=988600001 AND currency_code='point') points,
      (SELECT CAST(stack.quantity AS CHAR) FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=988600001 AND item.code='legacy-castle-battle-reset-ticket') tickets`))[0]!;
}

try {
  if (restart) {
    const before = await snapshot();
    const replay = await battle(`${base}-free`);
    assert.equal(replay.replayed,true);
    assert.deepEqual(await snapshot(),before);
    process.stdout.write(`${JSON.stringify({mode:"verify-restart",operations:Number(before.operations),additionalSettlement:false,operationalDataTouched:false})}\n`);
  } else {
    await database.execute("UPDATE castle_battle_seasons SET status='closed'");
    await database.execute("INSERT INTO castle_battle_seasons(season_key,status,starts_at,version) VALUES ('synthetic-castle-g7','active',UTC_TIMESTAMP(3),1)");
    await database.execute("INSERT INTO players(id,status) VALUES (988600001,'active'),(988600002,'active')");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,level,experience) VALUES (988600001,'합성 공격자',10,0),(988600002,'합성 방어자',10,0)");
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (988600001,'kakao','castle-attacker','합성 공격자','linked'),(988600002,'kakao','castle-defender','합성 방어자','linked')");
    await database.execute("INSERT INTO pet_definitions(code,display_name,active) VALUES ('synthetic-sky','하늘',TRUE),('synthetic-land','땅',TRUE)");
    await database.execute("INSERT INTO player_pets(id,player_id,display_name,pet_type_code,image_value,experience,enhancement_level) VALUES (988610001,988600001,'공격펫','synthetic-sky','🐶',2000,0),(988610002,988600002,'방어펫','synthetic-land','🐱',1000,0)");
    await database.execute("INSERT INTO currency_accounts(player_id,currency_code,balance) VALUES (988600001,'point',0),(988600002,'point',0)");
    await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity) SELECT 988600001,id,2 FROM item_definitions WHERE code='legacy-castle-battle-reset-ticket'");
    const rollout = (await database.query<Array<{ rollout_state:string }>>("SELECT rollout_state FROM command_registry WHERE command_code='CASTLE_BATTLE_EXECUTE'"))[0]!;
    assert.equal(rollout.rollout_state,"SHADOW");
    await event(`${base}-free`);
    const first = await battle(`${base}-free`);
    assert.equal(first.replayed,false);
    assert.deepEqual(await battle(`${base}-free`),{...first,replayed:true});
    await event(`${base}-ticket`);
    await battle(`${base}-ticket`);
    const expected = { operations:2n,settlements:2n,outboxes:2n,audits:2n,attempts:"2",points:"20000000.000",tickets:"1" };
    assert.deepEqual(await snapshot(),expected);
    const rollbackId = `${base}-rollback`;
    await event(rollbackId);
    const rollbackService = new CastleBattleExecuteService(failAudit(database));
    await assert.rejects(()=>rollbackService.handle({externalUserId:"castle-attacker",channelId:"synthetic-castle-room",message:"/캐슬대전",eventId:rollbackId}),/synthetic castle battle audit failure/);
    assert.deepEqual(await snapshot(),expected);
    assert.equal(await database.verifyRollback(),true);
    process.stdout.write(`${JSON.stringify({mode:"probe",scenarios:["shadow-registry","free-battle","ticket-battle","deterministic-replay","atomic-rollback"],effects:{operations:2,settlements:2,attempts:2,points:20000000,tickets:1},operationalDataTouched:false})}\n`);
  }
} finally {
  await database.close();
}
