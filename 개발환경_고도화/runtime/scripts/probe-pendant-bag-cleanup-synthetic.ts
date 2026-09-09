import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PendantBagCleanupService } from "../src/pet/pendant-bag-cleanup-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_pendant_bag_cleanup(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`Synthetic pendant bag cleanup probe blocked: ${config.database.name}`);
}
const base = process.env.PENDANT_BAG_CLEANUP_PROBE_EVENT_ID ?? "pendant-bag-cleanup-g7-20260827-r1";
const restart = process.argv.includes("--verify-restart");
const db = createDatabaseClient(config.database);
const service = new PendantBagCleanupService(db);
const user = "pendant-cleanup-user";
const room = "synthetic-pendant-bag-cleanup-room";

// command_executions 외래 키를 만족하는 비식별 합성 이벤트를 준비합니다.
async function event(id: string): Promise<void> {
  await db.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",
    [id, id, room, user]
  );
}

// 감사 기록 직전 실패를 주입해 전체 트랜잭션 rollback을 검증합니다.
function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(),
    query: (sql, params) => inner.query(sql, params),
    execute: (sql, params) => inner.execute(sql, params),
    verifyRollback: () => inner.verifyRollback(),
    close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) =>
      inner.withTransaction((transaction) => work({
        query: (sql, params) => transaction.query(sql, params),
        execute: async (sql, params) => {
          if (sql.includes("INSERT INTO command_audit")) {
            throw new Error("synthetic pendant bag cleanup audit failure");
          }
          return transaction.execute(sql, params);
        }
      }))
  };
}

try {
  const success = `${base}-success`;
  if (restart) {
    const before = await db.query<Array<{
      ops: bigint;
      outboxes: bigint;
      totalInstances: bigint;
      ownedInstances: bigint;
      consumedInstances: bigint;
      balance: string;
    }>>(
      "SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pendant.bag_cleanup' AND idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes,(SELECT COUNT(*) FROM inventory_instances) totalInstances,(SELECT COUNT(*) FROM inventory_instances WHERE status='owned') ownedInstances,(SELECT COUNT(*) FROM inventory_instances WHERE status='consumed') consumedInstances,(SELECT CAST(balance AS CHAR) FROM currency_accounts WHERE player_id=987000001 AND currency_code='point') balance",
      [success, success]
    );
    await service.handle({ eventId: success, externalUserId: user, destinationId: room, message: "/펜던트가방정리 5~2" });
    const after = await db.query<typeof before>(
      "SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pendant.bag_cleanup' AND idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes,(SELECT COUNT(*) FROM inventory_instances) totalInstances,(SELECT COUNT(*) FROM inventory_instances WHERE status='owned') ownedInstances,(SELECT COUNT(*) FROM inventory_instances WHERE status='consumed') consumedInstances,(SELECT CAST(balance AS CHAR) FROM currency_accounts WHERE player_id=987000001 AND currency_code='point') balance",
      [success, success]
    );
    assert.deepEqual(after, before);
    assert.deepEqual(after[0], {
      ops: 1n,
      outboxes: 1n,
      totalInstances: 6n,
      ownedInstances: 2n,
      consumedInstances: 4n,
      balance: "400000050.000"
    });
    process.stdout.write(JSON.stringify({
      mode: "verify-restart",
      operationCount: 1,
      outboxCount: 1,
      totalInstances: 6,
      ownedInstances: 2,
      consumedInstances: 4,
      balance: "400000050.000",
      additionalMutation: false,
      operationalDataTouched: false
    }) + "\n");
  } else {
    await db.execute("INSERT INTO players(id,status) VALUES (987000001,'active')");
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (987000001,'정리 남')");
    await db.execute("INSERT INTO external_identities(provider_code,external_user_id,player_id,status) VALUES ('kakao',?,987000001,'linked')", [user]);
    await db.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (987000001,'⭐',1)");
    await db.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (987000001,'point',50,1)");
    for (let index = 1; index <= 6; index++) {
      const code = `PENDANT-CLEAN-SYN-${index}`;
      await db.execute(
        "INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES (?,?, 'ITEM',0,JSON_OBJECT('objectType','pendant'),1,1)",
        [code, `합성정리펜던트${index}`]
      );
      await db.execute(
        "INSERT INTO inventory_instances(player_id,item_id,status,attributes_json) SELECT 987000001,id,'owned',JSON_OBJECT('objectType','pendant','name',?,'icon','💎','grade',?,'durability',4,'maxDurability',5,'upgrade',2) FROM item_definitions WHERE code=?",
        [`펜던트${index}`, index <= 2 ? "창조" : index <= 4 ? "신화" : "하급", code]
      );
    }
    assert.equal(
      (await db.query<Array<{ rollout_state: string }>>(
        "SELECT rollout_state FROM command_registry WHERE command_code='PENDANT_BAG_CLEANUP'"
      ))[0]!.rollout_state,
      "SHADOW"
    );

    await event(success);
    const result = await service.handle({
      eventId: success,
      externalUserId: user,
      destinationId: room,
      message: "/펜던트가방정리 5~2"
    });
    assert.equal(result.status, "cleaned");
    assert.equal(result.removedCount, 4);
    assert.equal(result.pointGranted, "400000000");
    assert.match(result.data!, /^\[⭐정리 남\] 님\n펜던트 4개를 정리했습니다\.\n획득 포인트💸: 🅟400,000,000$/);
    assert.deepEqual(
      await service.handle({ eventId: success, externalUserId: user, destinationId: room, message: "/펜던트가방정리 5~2" }),
      result
    );

    const invalid = `${base}-invalid`;
    await event(invalid);
    const invalidResult = await service.handle({
      eventId: invalid,
      externalUserId: user,
      destinationId: room,
      message: "/펜던트가방정리 1~9"
    });
    assert.equal(invalidResult.status, "invalid_range");

    const rollback = `${base}-rollback`;
    await event(rollback);
    await assert.rejects(
      () => new PendantBagCleanupService(failAudit(db)).handle({
        eventId: rollback,
        externalUserId: user,
        destinationId: room,
        message: "/펜던트가방정리 1~1"
      }),
      /synthetic pendant bag cleanup audit failure/
    );

    const effects = await db.query<Array<{
      successOps: bigint;
      successOutboxes: bigint;
      invalidOps: bigint;
      rollbackOps: bigint;
      totalInstances: bigint;
      ownedInstances: bigint;
      consumedInstances: bigint;
      inventoryLedger: bigint;
      currencyLedger: bigint;
      balance: string;
    }>>(
      "SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) successOps,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) successOutboxes,(SELECT COUNT(*) FROM operations WHERE idempotency_key=?) invalidOps,(SELECT COUNT(*) FROM operations WHERE idempotency_key=?) rollbackOps,(SELECT COUNT(*) FROM inventory_instances) totalInstances,(SELECT COUNT(*) FROM inventory_instances WHERE status='owned') ownedInstances,(SELECT COUNT(*) FROM inventory_instances WHERE status='consumed') consumedInstances,(SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id=ledger.operation_id WHERE operation_row.idempotency_key=?) inventoryLedger,(SELECT COUNT(*) FROM currency_ledger ledger JOIN operations operation_row ON operation_row.id=ledger.operation_id WHERE operation_row.idempotency_key=?) currencyLedger,(SELECT CAST(balance AS CHAR) FROM currency_accounts WHERE player_id=987000001 AND currency_code='point') balance",
      [success, success, invalid, rollback, success, success]
    );
    assert.deepEqual(effects[0], {
      successOps: 1n,
      successOutboxes: 1n,
      invalidOps: 1n,
      rollbackOps: 0n,
      totalInstances: 6n,
      ownedInstances: 2n,
      consumedInstances: 4n,
      inventoryLedger: 4n,
      currencyLedger: 1n,
      balance: "400000050.000"
    });
    assert.equal(await db.verifyRollback(), true);
    process.stdout.write(JSON.stringify({
      mode: "probe",
      migrationCount: 118,
      scenarios: [
        "shadow-registry",
        "reversed-range",
        "stable-instance-consume",
        "point-ledger",
        "invalid-range",
        "replay",
        "rollback"
      ],
      effects: {
        successOperation: 1,
        successOutbox: 1,
        invalidOperation: 1,
        rollbackOperation: 0,
        totalInstances: 6,
        ownedInstances: 2,
        consumedInstances: 4,
        inventoryLedger: 4,
        currencyLedger: 1,
        balance: "400000050.000"
      },
      operationalDataTouched: false
    }) + "\n");
  }
} finally {
  await db.close();
}
