import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PendantDrawOpenService } from "../src/pet/pendant-draw-open-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_pendant_draw_open(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic pendant draw probe blocked: ${config.database.name}`);
const base = process.env.PENDANT_DRAW_OPEN_PROBE_EVENT_ID ?? "pendant-draw-open-g7-20260827-r1";
const restart = process.argv.includes("--verify-restart");
const db = createDatabaseClient(config.database);
const room = "synthetic-pendant-draw-room";
const broadcastRooms = ["synthetic-notice-room-1", "synthetic-notice-room-2"];
const actor = "pendant-draw-actor";
const successEvent = `${base}-success`;

// command execution 외래 키용 비식별 합성 event를 준비합니다.
async function event(id: string): Promise<void> {
  await db.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('d',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",
    [id, id, room, actor]
  );
}

// 감사 직전 실패를 주입해 티켓·인스턴스·원장·추첨·outbox 전체 rollback을 검증합니다.
function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params),
    verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction(transaction => work({
      query: (sql, params) => transaction.query(sql, params),
      execute: async (sql, params) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic pendant draw audit failure");
        return transaction.execute(sql, params);
      }
    }))
  };
}

async function snapshot(): Promise<Array<{ instances: bigint; ticketQuantity: bigint; ticketVersion: bigint; operations: bigint; outboxes: bigint; audits: bigint; draws: bigint; ledgers: bigint }>> {
  return db.query(`SELECT
    (SELECT COUNT(*) FROM inventory_instances WHERE player_id=983000000) instances,
    (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=983000000 AND item.code='ITEM-PENDANT-DRAW-TICKET') ticketQuantity,
    (SELECT stack.version FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=983000000 AND item.code='ITEM-PENDANT-DRAW-TICKET') ticketVersion,
    (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pendant.draw.open') operations,
    (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope='pendant.draw.open') outboxes,
    (SELECT COUNT(*) FROM command_audit WHERE action_code='pendant.draw.open') audits,
    (SELECT COUNT(*) FROM pendant_draw_results) draws,
    (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation ON operation.id=ledger.operation_id WHERE operation.idempotency_scope='pendant.draw.open') ledgers`);
}

try {
  const expected = { instances: 52n, ticketQuantity: 3n, ticketVersion: 2n, operations: 2n, outboxes: 4n, audits: 2n, draws: 3n, ledgers: 4n };
  if (restart) {
    const before = await snapshot();
    const replay = await new PendantDrawOpenService(db, () => { throw new Error("replay consumed RNG"); }, broadcastRooms).handle({ eventId: successEvent, externalUserId: actor, destinationId: room, message: "/펜던트오픈 3" });
    assert.equal(replay.status, "success");
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(before[0], expected);
    process.stdout.write(JSON.stringify({ mode: "verify-restart", operationCount: 2, drawCount: 3, additionalMutation: false, operationalDataTouched: false }) + "\n");
  } else {
    await db.execute("INSERT INTO players(id,status) VALUES (983000000,'active')");
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (983000000,'추첨자')");
    await db.execute("INSERT INTO player_pets(id,player_id,display_name) VALUES (983100000,983000000,'추첨자의 펫')");
    await db.execute("INSERT INTO external_identities(id,provider_code,external_user_id,player_id,status) VALUES (983200000,'kakao',?,983000000,'linked')", [actor]);
    await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT 983000000,id,6,1 FROM item_definitions WHERE code='ITEM-PENDANT-DRAW-TICKET'");
    const quiet = (await db.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code='ITEM-PENDANT-DRAW-QUIET'"))[0]!.id;
    for (let index = 0; index < 49; index++) {
      await db.execute("INSERT INTO inventory_instances(player_id,item_id,status,attributes_json,version) VALUES (983000000,?,'owned',JSON_OBJECT('objectType','pendant','name',?,'grade','최하급','upgrade',0,'durability',5,'maxDurability',5),1)", [quiet, `기존펜던트${index + 1}`]);
    }
    assert.equal((await db.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='PENDANT_DRAW_OPEN'"))[0]!.rollout_state, "SHADOW");
    const rollbackEvent = `${base}-rollback`;
    await event(rollbackEvent);
    const beforeRollback = await snapshot();
    await assert.rejects(() => new PendantDrawOpenService(failAudit(db), () => 0, broadcastRooms).handle({ eventId: rollbackEvent, externalUserId: actor, destinationId: room, message: "/펜던트오픈 2" }), /synthetic pendant draw audit failure/);
    assert.deepEqual(await snapshot(), beforeRollback);
    assert.equal(await db.verifyRollback(), true);
    await event(successEvent);
    const samples = [0.99995, 0, 0.4];
    const service = new PendantDrawOpenService(db, () => samples.shift()!, broadcastRooms);
    const result = await service.handle({ eventId: successEvent, externalUserId: actor, destinationId: room, message: "/펜던트오픈 3" });
    assert.equal(result.status, "success");
    assert.equal(result.openCount, 3);
    assert.equal(result.replies?.length, 3);
    assert.match(result.data!, /창조의 펜던트/);
    assert.ok(result.data!.indexOf("창조의 펜던트") < result.data!.indexOf("조용한 펜던트"));
    assert.deepEqual(result.replies?.slice(1).map(reply => reply.room), broadcastRooms);
    const replay = await new PendantDrawOpenService(db, () => { throw new Error("replay consumed RNG"); }, broadcastRooms).handle({ eventId: successEvent, externalUserId: actor, destinationId: room, message: "/펜던트오픈 3" });
    assert.deepEqual(replay, result);
    const fullEvent = `${base}-full`;
    await event(fullEvent);
    assert.equal((await new PendantDrawOpenService(db, () => 0, broadcastRooms).handle({ eventId: fullEvent, externalUserId: actor, destinationId: room, message: "/펜던트오픈" })).status, "bag_full");
    assert.equal((await new PendantDrawOpenService(db).handle({ eventId: `${base}-suffix`, externalUserId: actor, destinationId: room, message: "/펜던트오픈 1 해봐" })).status, "silent");
    const effects = await snapshot();
    assert.deepEqual(effects[0], expected);
    process.stdout.write(JSON.stringify({ mode: "probe", migrationCount: 128, scenarios: ["shadow-registry", "numeric-guard", "rollback", "ticket-cap", "legacy-bag-overflow", "grade-sort", "draw-order-notice", "configured-broadcast", "replay", "bag-full", "suffix-rejected"], effects: effects[0], operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? Number(value) : value) + "\n");
  }
} finally {
  await db.close();
}
