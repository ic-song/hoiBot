import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { FreeMarketReadService } from "../src/market/free-market-read-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_free_market_read(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic free market read probe blocked: ${config.database.name}`);
const db = createDatabaseClient(config.database);
const user = "free-market-viewer";
const room = "synthetic-free-market-room";
const base = "free-market-read-g7-20260828-r1";

async function event(id: string): Promise<void> {
  await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3))", [id, id, room, user]);
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params), verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({ query: (sql, params) => transaction.query(sql, params), execute: async (sql, params) => { if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic free market audit failure"); return transaction.execute(sql, params); } }))
  };
}

async function counts(): Promise<Array<{ listings: bigint; operations: bigint; executions: bigint; outboxes: bigint; audits: bigint }>> {
  return db.query(`SELECT
    (SELECT COUNT(*) FROM market_listings) listings,
    (SELECT COUNT(*) FROM operations WHERE idempotency_scope='market.free_market.read') operations,
    (SELECT COUNT(*) FROM command_executions WHERE command_code='MARKET_FREE_MARKET_READ') executions,
    (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope='market.free_market.read') outboxes,
    (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id=audit.operation_id WHERE operation.idempotency_scope='market.free_market.read') audits`);
}

async function verifyRestart(): Promise<void> {
  const count = (await counts())[0]!;
  assert.equal(count.listings, 4n);
  assert.equal(count.operations, 3n);
  assert.equal(count.executions, 3n);
  assert.equal(count.outboxes, 3n);
  assert.equal(count.audits, 3n);
  process.stdout.write(JSON.stringify({ mode: "verify-restart", listings: 4, operations: 3, additionalMutation: false, operationalDataTouched: false }) + "\n");
}

async function probe(): Promise<void> {
  await db.execute("INSERT INTO players(id,status) VALUES(992000001,'active'),(992000002,'active'),(992000003,'inactive')");
  await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES(992000001,'조회자'),(992000002,'새판매자'),(992000003,'옛판매자')");
  await db.execute("INSERT INTO external_identities(id,provider_code,external_user_id,player_id,status) VALUES(992200001,'kakao',?,992000001,'linked')", [user]);
  await db.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES(992000002,'👑',1),(992000003,'🌙',2)");
  await db.execute("INSERT INTO item_definitions(id,code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES(992400001,'FREE-MARKET-STACK','합성 상자','ITEM',1,NULL,1,1),(992400002,'FREE-MARKET-INSTANCE','합성 펜던트','ITEM',0,JSON_OBJECT('objectType','pendant'),1,1)");
  await db.execute("INSERT INTO inventory_instances(id,player_id,item_id,status,attributes_json,version) VALUES(992100001,992000002,992400002,'reserved',JSON_OBJECT('name','빛나는 펜던트','icon','💎','grade','창세'),1)");
  await db.execute(`INSERT INTO market_listings(id,seller_player_id,asset_type_code,item_id,inventory_instance_id,quantity,price_currency_code,price_amount,status,created_at,expires_at) VALUES
    (992500001,992000002,'stack',992400001,NULL,3,'point',1000,'open',DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 3 MINUTE),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY)),
    (992500002,992000003,'stack',992400001,NULL,2,'diamond',25,'open',DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 MINUTE),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY)),
    (992500003,992000002,'instance',992400002,992100001,1,'point',1234567,'open',DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY)),
    (992500004,992000002,'stack',992400001,NULL,9,'point',9999,'completed',UTC_TIMESTAMP(3),NULL)`);
  assert.equal((await db.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='MARKET_FREE_MARKET_READ'"))[0]!.rollout_state, "SHADOW");
  const service = new FreeMarketReadService(db);
  const firstId = `${base}-primary`;
  await event(firstId);
  const first = await service.read({ eventId: firstId, externalUserId: user, destinationId: room });
  assert.equal(first?.status, "shown");
  assert.equal(first?.count, 3);
  assert.deepEqual(first?.listingIds, ["992500003", "992500002", "992500001"]);
  assert.match(first!.data, /👑새판매자/);
  assert.match(first!.data, /탈퇴회원/);
  assert.doesNotMatch(first!.data, /옛판매자|9999/);
  const beforeReplay = await counts();
  assert.deepEqual(await service.read({ eventId: firstId, externalUserId: user, destinationId: room }), first);
  assert.deepEqual(await counts(), beforeReplay);
  const aliasId = `${base}-alias`;
  await event(aliasId);
  const alias = await service.read({ eventId: aliasId, externalUserId: user, destinationId: room });
  assert.equal(alias?.data, first?.data);
  const concurrentId = `${base}-concurrent`;
  await event(concurrentId);
  const concurrent = await Promise.all([service.read({ eventId: concurrentId, externalUserId: user, destinationId: room }), service.read({ eventId: concurrentId, externalUserId: user, destinationId: room })]);
  assert.deepEqual(concurrent[0], concurrent[1]);
  const rollbackId = `${base}-rollback`;
  await event(rollbackId);
  const beforeRollback = await counts();
  await assert.rejects(() => new FreeMarketReadService(failAudit(db)).read({ eventId: rollbackId, externalUserId: user, destinationId: room }), /synthetic free market audit failure/);
  assert.deepEqual(await counts(), beforeRollback);
  assert.equal(await db.verifyRollback(), true);
  const count = (await counts())[0]!;
  assert.deepEqual({ operations: count.operations, executions: count.executions, outboxes: count.outboxes, audits: count.audits }, { operations: 3n, executions: 3n, outboxes: 3n, audits: 3n });
  process.stdout.write(JSON.stringify({ mode: "probe", migrationCount: 246, scenarios: ["shadow", "exact-alias", "order", "rank", "missing-seller", "instance", "visibility", "replay", "concurrent-read", "redacted-audit", "rollback"], effects: { operations: 3, executions: 3, outboxes: 3, audits: 3 }, listings: 4, operationalDataTouched: false }) + "\n");
}

try {
  if (process.argv.includes("--verify-restart")) await verifyRestart(); else await probe();
} finally {
  await db.close();
}
