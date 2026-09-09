import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { SpiritNameCombineService } from "../src/pet/spirit-name-combine-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_spirit_name_combine(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`Synthetic spirit name combine probe is blocked for database: ${config.database.name}`);
}
const base = process.env.SPIRIT_NAME_COMBINE_PROBE_EVENT_ID ?? "spirit-name-combine-g7-20260827-r1";
const restart = process.argv.includes("--verify-restart");
const database = createDatabaseClient(config.database);
const service = new SpiritNameCombineService(database);

// command_executions 외래 키를 만족하는 비식별 이벤트를 준비합니다.
async function event(id: string): Promise<void> {
  await database.execute(`INSERT INTO event_inbox
    (event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at)
    VALUES (?,?,'synthetic-spirit-combine-room','spirit-combine-user','message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)`, [id,id]);
}

// 양념치킨만 보유하고 변경권 stack은 없는 비식별 사용자를 준비합니다.
async function fixtures(): Promise<void> {
  await database.execute("INSERT INTO players(id,status) VALUES (985000001,'active')");
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (985000001,'조합대상')");
  await database.execute(`INSERT INTO external_identities
    (id,player_id,provider_code,external_user_id,display_name,status)
    VALUES (995000001,985000001,'kakao','spirit-combine-user','조합대상','linked')`);
  await database.execute(`INSERT INTO inventory_stacks(player_id,item_id,quantity)
    SELECT 985000001,id,120 FROM item_definitions WHERE code='ITEM-RWD-SEASONED-CHICKEN'`);
}

// 감사 실패를 주입해 재료 차감과 변경권 생성 전체 rollback을 검증합니다.
function failAudit(inner: DatabaseClient): DatabaseClient {
  return { ping:()=>inner.ping(), query:(s,p)=>inner.query(s,p), execute:(s,p)=>inner.execute(s,p),
    verifyRollback:()=>inner.verifyRollback(), close:async()=>undefined,
    withTransaction:<T>(work:(t:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction((t)=>work({
      query:(s,p)=>t.query(s,p), execute:async(s,p)=>{
        if(s.includes("INSERT INTO command_audit")) throw new Error("synthetic spirit combine audit failure");
        return t.execute(s,p);
      }
    })) };
}

try {
  const successEvent=`${base}-success`;
  if(restart){
    const before=await database.query<Array<{chicken:bigint;ticket:bigint;ops:bigint}>>(`SELECT
      (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=985000001 AND item.code='ITEM-RWD-SEASONED-CHICKEN') chicken,
      (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=985000001 AND item.code='legacy-spirit-name-change-ticket') ticket,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.spirit_name_combine:995000001' AND idempotency_key=?) ops`,[successEvent]);
    await service.handle({externalUserId:"spirit-combine-user",channelId:"synthetic-spirit-combine-room",message:"/정령이름조합",eventId:successEvent});
    const after=await database.query<typeof before>(`SELECT
      (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=985000001 AND item.code='ITEM-RWD-SEASONED-CHICKEN') chicken,
      (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=985000001 AND item.code='legacy-spirit-name-change-ticket') ticket,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.spirit_name_combine:995000001' AND idempotency_key=?) ops`,[successEvent]);
    assert.deepEqual(after,before); assert.deepEqual(after[0],{chicken:120n,ticket:1n,ops:1n});
    process.stdout.write(JSON.stringify({mode:"verify-restart",chicken:120,ticket:1,operationCount:1,additionalMutation:false,operationalDataTouched:false})+"\n");
  }else{
    await fixtures(); await event(successEvent);
    const registry=await database.query<Array<{rollout_state:string}>>("SELECT rollout_state FROM command_registry WHERE command_code='SPIRIT_NAME_COMBINE'");
    assert.equal(registry[0]?.rollout_state,"SHADOW");
    const command={externalUserId:"spirit-combine-user",channelId:"synthetic-spirit-combine-room",message:"/정령이름조합",eventId:successEvent};
    const result=await service.handle(command); assert.equal(result.status,"crafted"); assert.deepEqual(await service.handle(command),result);
    const rollbackEvent=`${base}-rollback`; await event(rollbackEvent);
    await database.execute("UPDATE inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id SET stack.quantity=120 WHERE stack.player_id=985000001 AND item.code='ITEM-RWD-SEASONED-CHICKEN'");
    await assert.rejects(()=>new SpiritNameCombineService(failAudit(database)).handle({...command,eventId:rollbackEvent}),/synthetic spirit combine audit failure/);
    const effects=await database.query<Array<{chicken:bigint;ticket:bigint;ledger:bigint;ops:bigint;outboxes:bigint;rollbackOps:bigint}>>(`SELECT
      (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=985000001 AND item.code='ITEM-RWD-SEASONED-CHICKEN') chicken,
      (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=985000001 AND item.code='legacy-spirit-name-change-ticket') ticket,
      (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id=ledger.operation_id WHERE operation_row.idempotency_key=?) ledger,
      (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) ops,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes,
      (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) rollbackOps`,[successEvent,successEvent,successEvent,rollbackEvent]);
    assert.deepEqual(effects[0],{chicken:120n,ticket:1n,ledger:2n,ops:1n,outboxes:1n,rollbackOps:0n});
    assert.equal(await database.verifyRollback(),true);
    process.stdout.write(JSON.stringify({mode:"probe",migrationCount:115,scenarios:["shadow-registry","missing-ticket-stack","success","replay","rollback"],effects:{ticket:1,ledger:2,operation:1,outbox:1,rollbackOperation:0},operationalDataTouched:false})+"\n");
  }
}finally{await database.close();}
