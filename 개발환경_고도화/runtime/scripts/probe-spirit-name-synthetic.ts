import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { SpiritNameService } from "../src/pet/spirit-name-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_spirit_name(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`Synthetic spirit name probe is blocked for database: ${config.database.name}`);
}
const base = process.env.SPIRIT_NAME_PROBE_EVENT_ID ?? "spirit-name-g7-20260827-r1";
const restart = process.argv.includes("--verify-restart");
const database = createDatabaseClient(config.database);
const service = new SpiritNameService(database);

// command_executions 외래 키를 만족하는 비식별 이벤트를 준비합니다.
async function event(id: string): Promise<void> {
  await database.execute(`INSERT INTO event_inbox
    (event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at)
    VALUES (?,?,'synthetic-spirit-name-room','spirit-name-user','message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)`, [id, id]);
}

// 정령과 이름변경권을 보유한 비식별 사용자를 준비합니다.
async function fixtures(): Promise<void> {
  await database.execute("INSERT INTO players(id,status) VALUES (984000001,'active')");
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (984000001,'이름대상')");
  await database.execute("INSERT INTO player_pets(id,player_id,display_name) VALUES (984000001,984000001,'합성정령펫')");
  await database.execute(`INSERT INTO player_pet_elementals
    (player_pet_id,display_name,grade_code,grade_display_name,enhancement_level)
    VALUES (984000001,'이전정령','ELEMENTAL-GRADE-001','수련생',3)`);
  await database.execute(`INSERT INTO external_identities
    (id,player_id,provider_code,external_user_id,display_name,status)
    VALUES (994000001,984000001,'kakao','spirit-name-user','이름대상','linked')`);
  await database.execute(`INSERT INTO inventory_stacks(player_id,item_id,quantity)
    SELECT 984000001,id,2 FROM item_definitions WHERE code='legacy-spirit-name-change-ticket'`);
}

// 감사 기록 실패를 주입해 이름·변경권 변경 전체 rollback을 검증합니다.
function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (s,p) => inner.query(s,p), execute: (s,p) => inner.execute(s,p),
    verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (t: DatabaseTransaction) => Promise<T>) => inner.withTransaction((t) => work({
      query: (s,p) => t.query(s,p),
      execute: async (s,p) => {
        if (s.includes("INSERT INTO command_audit")) throw new Error("synthetic spirit name audit failure");
        return t.execute(s,p);
      }
    }))
  };
}

try {
  const successEvent = `${base}-success`;
  if (restart) {
    const before = await database.query<Array<{ name:string; ticket:bigint; ops:bigint }>>(`SELECT
      (SELECT display_name FROM player_pet_elementals WHERE player_pet_id=984000001) name,
      (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id
       WHERE stack.player_id=984000001 AND item.code='legacy-spirit-name-change-ticket') ticket,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.spirit_name:994000001' AND idempotency_key=?) ops`, [successEvent]);
    await service.handle({ externalUserId:"spirit-name-user", channelId:"synthetic-spirit-name-room", message:"/정령이름 새 정령", eventId:successEvent });
    const after = await database.query<typeof before>(`SELECT
      (SELECT display_name FROM player_pet_elementals WHERE player_pet_id=984000001) name,
      (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id
       WHERE stack.player_id=984000001 AND item.code='legacy-spirit-name-change-ticket') ticket,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.spirit_name:994000001' AND idempotency_key=?) ops`, [successEvent]);
    assert.deepEqual(after, before);
    assert.deepEqual(after[0], { name:"새 정령", ticket:1n, ops:1n });
    process.stdout.write(JSON.stringify({ mode:"verify-restart", name:"새 정령", ticket:1, operationCount:1, additionalMutation:false, operationalDataTouched:false }) + "\n");
  } else {
    await fixtures();
    await event(successEvent);
    const registry = await database.query<Array<{ rollout_state:string }>>("SELECT rollout_state FROM command_registry WHERE command_code='SPIRIT_NAME_MUTATE'");
    assert.equal(registry[0]?.rollout_state, "SHADOW");
    const result = await service.handle({ externalUserId:"spirit-name-user", channelId:"synthetic-spirit-name-room", message:"/정령이름 새 정령", eventId:successEvent });
    assert.equal(result.status, "renamed");
    const replay = await service.handle({ externalUserId:"spirit-name-user", channelId:"synthetic-spirit-name-room", message:"/정령이름 새 정령", eventId:successEvent });
    assert.deepEqual(replay, result);
    const rollbackEvent = `${base}-rollback`;
    await event(rollbackEvent);
    await assert.rejects(() => new SpiritNameService(failAudit(database)).handle({
      externalUserId:"spirit-name-user", channelId:"synthetic-spirit-name-room", message:"/정령이름 롤백정령", eventId:rollbackEvent
    }), /synthetic spirit name audit failure/);
    const effects = await database.query<Array<{ name:string; ticket:bigint; ledger:bigint; ops:bigint; outboxes:bigint; rollbackOps:bigint }>>(`SELECT
      (SELECT display_name FROM player_pet_elementals WHERE player_pet_id=984000001) name,
      (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id
       WHERE stack.player_id=984000001 AND item.code='legacy-spirit-name-change-ticket') ticket,
      (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id=ledger.operation_id
       WHERE operation_row.idempotency_scope='pet.spirit_name:994000001' AND operation_row.idempotency_key=?) ledger,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.spirit_name:994000001' AND idempotency_key=?) ops,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id
       WHERE operation_row.idempotency_key=?) outboxes,
      (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) rollbackOps`, [successEvent,successEvent,successEvent,rollbackEvent]);
    assert.deepEqual(effects[0], { name:"새 정령", ticket:1n, ledger:1n, ops:1n, outboxes:1n, rollbackOps:0n });
    assert.equal(await database.verifyRollback(), true);
    process.stdout.write(JSON.stringify({ mode:"probe", migrationCount:114, scenarios:["shadow-registry","success","replay","rollback"], effects:{ name:"새 정령",ticket:1,ledger:1,operation:1,outbox:1,rollbackOperation:0 }, operationalDataTouched:false }) + "\n");
  }
} finally {
  await database.close();
}
