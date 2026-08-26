import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PendantEnhanceService } from "../src/pet/pendant-enhance-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_pendant_enhance(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`Synthetic pendant enhance probe blocked: ${config.database.name}`);
}
const base = process.env.PENDANT_ENHANCE_PROBE_EVENT_ID ?? "pendant-enhance-g7-20260827-r1";
const restart = process.argv.includes("--verify-restart");
const db = createDatabaseClient(config.database);
const user = "pendant-enhance-user";
const room = "synthetic-pendant-enhance-room";
const playerId = 988000001;

// command_executions 외래 키를 만족하는 비식별 합성 이벤트를 준비합니다.
async function event(id: string): Promise<void> {
  await db.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",
    [id, id, room, user]
  );
}

// 감사 기록 직전 실패를 주입해 강화 전체 트랜잭션 rollback을 검증합니다.
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
          if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic pendant enhance audit failure");
          return transaction.execute(sql, params);
        }
      }))
  };
}

async function snapshot(): Promise<Array<{
  balance: string; stones: bigint; level: string; durability: string; version: bigint;
  operations: bigint; confirmOperations: bigint; outboxes: bigint; confirmations: bigint;
  consumed: bigint; cancelled: bigint; currencyLedger: bigint; inventoryLedger: bigint;
}>> {
  return db.query(
    `SELECT
      (SELECT CAST(balance AS CHAR) FROM currency_accounts WHERE player_id=? AND currency_code='point') balance,
      (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code='ITEM-PENDANT-ENHANCE-STONE') stones,
      (SELECT JSON_UNQUOTE(JSON_EXTRACT(attributes_json,'$.upgrade')) FROM inventory_instances WHERE player_id=? LIMIT 1) level,
      (SELECT JSON_UNQUOTE(JSON_EXTRACT(attributes_json,'$.durability')) FROM inventory_instances WHERE player_id=? LIMIT 1) durability,
      (SELECT version FROM inventory_instances WHERE player_id=? LIMIT 1) version,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'pendant.enhance.%') operations,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pendant.enhance.confirm') confirmOperations,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope LIKE 'pendant.enhance.%') outboxes,
      (SELECT COUNT(*) FROM pendant_upgrade_confirmations) confirmations,
      (SELECT COUNT(*) FROM pendant_upgrade_confirmations WHERE consumed_at IS NOT NULL) consumed,
      (SELECT COUNT(*) FROM pendant_upgrade_confirmations WHERE cancelled_at IS NOT NULL) cancelled,
      (SELECT COUNT(*) FROM currency_ledger WHERE reason_code='PENDANT_ENHANCE') currencyLedger,
      (SELECT COUNT(*) FROM inventory_ledger WHERE reason_code='PENDANT_ENHANCE') inventoryLedger`,
    [playerId, playerId, playerId, playerId, playerId]
  );
}

try {
  const successPreview = `${base}-success-preview`;
  const successConfirm = `${base}-success-confirm`;
  const failureConfirm = `${base}-failure-confirm`;
  if (restart) {
    const before = await snapshot();
    const replay = await new PendantEnhanceService(db, () => 0).handle({
      eventId: failureConfirm, externalUserId: user, destinationId: room, message: "진행시켜"
    });
    assert.equal(replay.status, "failure");
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(before[0], {
      balance: "4000000000.000", stones: 85n, level: "7", durability: "4", version: 3n,
      operations: 7n, confirmOperations: 2n, outboxes: 7n, confirmations: 4n,
      consumed: 2n, cancelled: 1n, currencyLedger: 2n, inventoryLedger: 2n
    });
    process.stdout.write(JSON.stringify({ mode: "verify-restart", ...before[0], additionalMutation: false, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? Number(value) : value) + "\n");
  } else {
    await db.execute("INSERT INTO players(id,status) VALUES (?,'active')", [playerId]);
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,'강화 남')", [playerId]);
    await db.execute("INSERT INTO external_identities(provider_code,external_user_id,player_id,status) VALUES ('kakao',?,?,'linked')", [user, playerId]);
    await db.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (?,'⭐',1)", [playerId]);
    await db.execute("INSERT INTO player_pets(player_id,display_name) VALUES (?,'합성 펫')", [playerId]);
    await db.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',10000000000,1)", [playerId]);
    await db.execute("INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES ('PENDANT-ENHANCE-SYN','합성강화펜던트','ITEM',0,JSON_OBJECT('objectType','pendant'),1,1)");
    await db.execute(
      "INSERT INTO inventory_instances(player_id,item_id,status,attributes_json) SELECT ?,id,'owned',JSON_OBJECT('objectType','pendant','name','합성강화펜던트','icon','💎','grade','하급','durability',5,'maxDurability',5,'upgrade',6,'charm',100000,'explore',1) FROM item_definitions WHERE code='PENDANT-ENHANCE-SYN'",
      [playerId]
    );
    await db.execute(
      "INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT ?,id,100,1 FROM item_definitions WHERE code='ITEM-PENDANT-ENHANCE-STONE'",
      [playerId]
    );
    await db.execute("INSERT INTO skill_definitions(code,display_name,rules_json,active) VALUES ('PENDANT-BLACKSMITH-SYN','결혼못한 대장장이',JSON_OBJECT('bonusRate',1),1)");
    await db.execute(
      "INSERT INTO pet_skills(player_pet_id,slot_no,skill_id,level,equipped) SELECT pet.id,1,skill.id,1,TRUE FROM player_pets pet JOIN skill_definitions skill ON skill.code='PENDANT-BLACKSMITH-SYN' WHERE pet.player_id=?",
      [playerId]
    );
    assert.equal((await db.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='PENDANT_ENHANCE'"))[0]!.rollout_state, "SHADOW");

    const serviceSuccess = new PendantEnhanceService(db, () => 0);
    await event(successPreview);
    const preview = await serviceSuccess.handle({ eventId: successPreview, externalUserId: user, destinationId: room, message: "/펜던트강화 1" });
    assert.equal(preview.status, "preview");
    assert.match(preview.data!, /34%/);
    assert.deepEqual((await snapshot())[0]?.balance, "10000000000.000");
    await event(successConfirm);
    const success = await serviceSuccess.handle({ eventId: successConfirm, externalUserId: user, destinationId: room, message: "진행시켜" });
    assert.equal(success.status, "success");
    assert.equal(success.level, 7);
    assert.deepEqual(await serviceSuccess.handle({ eventId: successConfirm, externalUserId: user, destinationId: room, message: "진행시켜" }), success);

    const cancelPreview = `${base}-cancel-preview`;
    const cancelEvent = `${base}-cancel`;
    await event(cancelPreview);
    assert.equal((await serviceSuccess.handle({ eventId: cancelPreview, externalUserId: user, destinationId: room, message: "/펜던트강화 1" })).status, "preview");
    await event(cancelEvent);
    assert.equal((await serviceSuccess.handle({ eventId: cancelEvent, externalUserId: user, destinationId: room, message: "쫄았음" })).status, "cancelled");

    const failurePreview = `${base}-failure-preview`;
    await event(failurePreview);
    assert.equal((await serviceSuccess.handle({ eventId: failurePreview, externalUserId: user, destinationId: room, message: "/펜던트강화 1" })).status, "preview");
    await event(failureConfirm);
    const failure = await new PendantEnhanceService(db, () => 1).handle({ eventId: failureConfirm, externalUserId: user, destinationId: room, message: "진행시켜" });
    assert.equal(failure.status, "failure");
    assert.equal(failure.level, 7);
    assert.equal(failure.durability, "4");

    const rollbackPreview = `${base}-rollback-preview`;
    const rollbackConfirm = `${base}-rollback-confirm`;
    await event(rollbackPreview);
    assert.equal((await serviceSuccess.handle({ eventId: rollbackPreview, externalUserId: user, destinationId: room, message: "/펜던트강화 1" })).status, "preview");
    const beforeRollback = await snapshot();
    await event(rollbackConfirm);
    await assert.rejects(
      () => new PendantEnhanceService(failAudit(db), () => 0).handle({ eventId: rollbackConfirm, externalUserId: user, destinationId: room, message: "진행시켜" }),
      /synthetic pendant enhance audit failure/
    );
    assert.deepEqual(await snapshot(), beforeRollback);
    assert.equal(await db.verifyRollback(), true);
    const effects = await snapshot();
    assert.deepEqual(effects[0], {
      balance: "4000000000.000", stones: 85n, level: "7", durability: "4", version: 3n,
      operations: 7n, confirmOperations: 2n, outboxes: 7n, confirmations: 4n,
      consumed: 2n, cancelled: 1n, currencyLedger: 2n, inventoryLedger: 2n
    });
    process.stdout.write(JSON.stringify({
      mode: "probe", migrationCount: 119,
      scenarios: ["shadow-registry", "preview-no-resource-mutation", "bonus-rate", "success", "cancel", "failure-durability", "replay", "rollback"],
      effects: effects[0], operationalDataTouched: false
    }, (_key, value) => typeof value === "bigint" ? Number(value) : value) + "\n");
  }
} finally {
  await db.close();
}
