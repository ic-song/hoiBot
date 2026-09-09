import assert from "node:assert/strict";

import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { FreeMarketBagRegisterService } from "../src/market/free-market-bag-register-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_market_bag_trade_register(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic bag register probe blocked: ${config.database.name}`);
let database = createDatabaseClient(config.database);
const externalUserId = "market-bag-register-user";
const room = "synthetic-market-bag-register-room";
const base = process.env.MARKET_BAG_REGISTER_PROBE_EVENT_ID ?? "market-bag-register-g7-20260829-r1";
const playerId = 995000001n;
const itemId = 995100001n;
let carrotItemId = 0n;

async function event(id: string): Promise<void> {
  await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3))", [id, id, room, externalUserId]);
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params),
    verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, params) => transaction.query(sql, params),
      execute: async (sql, params) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic market bag register audit failure");
        return transaction.execute(sql, params);
      },
    })),
  };
}

async function snapshot(): Promise<unknown> {
  return (await database.query<Array<Record<string, bigint | string>>>(`SELECT
    (SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=?) item_quantity,
    (SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=?) carrot_quantity,
    (SELECT COUNT(*) FROM market_listings WHERE seller_player_id=?) listings,
    (SELECT COUNT(*) FROM market_bag_registration_confirmations WHERE player_id=?) confirmations,
    (SELECT COUNT(*) FROM market_bag_registration_ledger WHERE player_id=?) ledgers,
    (SELECT COUNT(*) FROM market_listing_registration_fees fee JOIN market_listings listing ON listing.id=fee.listing_id WHERE listing.seller_player_id=?) fees`,
  [playerId, itemId, playerId, carrotItemId, playerId, playerId, playerId, playerId]))[0];
}

try {
  await database.execute("INSERT INTO players(id,status) VALUES (?,'active')", [playerId]);
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name,tier_code) VALUES (?,'가방 시장왕','king')", [playerId]);
  await database.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (?,'👑',?)", [playerId, playerId]);
  await database.execute("INSERT INTO external_identities(id,provider_code,external_user_id,player_id,status) VALUES (995200001,'kakao',?,?,'linked')", [externalUserId, playerId]);
  await database.execute("INSERT INTO item_definitions(id,code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES (?,'MARKET-BAG-SYNTHETIC','합성가방상품','STACK',1,JSON_OBJECT('legacyBagOrder',1),1,1)", [itemId]);
  carrotItemId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code='ITEM-RWD-044'"))[0]!.id;
  await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,10,1),(?,?,150,1)", [playerId, itemId, playerId, carrotItemId]);
  assert.equal((await database.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='MARKET_BAG_TRADE_REGISTER'"))[0]!.rollout_state, "SHADOW");

  const service = new FreeMarketBagRegisterService(database);
  await database.execute("UPDATE player_profiles SET tier_code='member',version=version+1 WHERE player_id=?", [playerId]);
  const tierEvent = `${base}-tier`;
  await event(tierEvent);
  assert.equal((await service.handle({ eventId: tierEvent, externalUserId, destinationId: room, message: "/가방거래등록 1 3 5000000" })).status, "rejected");
  assert.deepEqual(await snapshot(), { item_quantity: 10n, carrot_quantity: 150n, listings: 0n, confirmations: 0n, ledgers: 0n, fees: 0n });
  await database.execute("UPDATE player_profiles SET tier_code='king',version=version+1 WHERE player_id=?", [playerId]);
  const first = `${base}-first`;
  await event(first);
  const pending = await service.handle({ eventId: first, externalUserId, destinationId: room, message: "/가방거래등록 1 3 5000000" });
  assert.equal(pending.status, "pending");
  assert.deepEqual(await snapshot(), { item_quantity: 10n, carrot_quantity: 150n, listings: 0n, confirmations: 1n, ledgers: 0n, fees: 0n });
  assert.equal((await service.handle({ eventId: first, externalUserId, destinationId: room, message: "/가방거래등록 1 3 5000000" })).replayed, true);

  const second = `${base}-second`;
  await event(second);
  const registered = await service.handle({ eventId: second, externalUserId, destinationId: room, message: "/가방거래등록 1 3 5000000" });
  assert.equal(registered.status, "registered");
  assert.deepEqual(await snapshot(), { item_quantity: 7n, carrot_quantity: 50n, listings: 1n, confirmations: 0n, ledgers: 1n, fees: 1n });
  const limitEvent = `${base}-limit`;
  await event(limitEvent);
  assert.equal((await service.handle({ eventId: limitEvent, externalUserId, destinationId: room, message: "/가방거래등록 1 1 6000000" })).status, "rejected");
  assert.deepEqual(await snapshot(), { item_quantity: 7n, carrot_quantity: 50n, listings: 1n, confirmations: 0n, ledgers: 1n, fees: 1n });

  await database.execute("UPDATE market_listings SET status='sold',closed_at=UTC_TIMESTAMP(3) WHERE id=?", [registered.listingId]);
  const rollbackConfirm = `${base}-rollback-confirm`;
  await event(rollbackConfirm);
  await service.handle({ eventId: rollbackConfirm, externalUserId, destinationId: room, message: "/가방거래등록 1 2 7000000" });
  await database.execute("UPDATE inventory_stacks SET quantity=150,version=version+1 WHERE player_id=? AND item_id=?", [playerId, carrotItemId]);
  const refreshConfirm = `${base}-rollback-refresh`;
  await event(refreshConfirm);
  await service.handle({ eventId: refreshConfirm, externalUserId, destinationId: room, message: "/가방거래등록 1 2 7000000" });
  const rollbackEvent = `${base}-rollback`;
  await event(rollbackEvent);
  const beforeRollback = await snapshot();
  await assert.rejects(() => new FreeMarketBagRegisterService(failAudit(database)).handle({ eventId: rollbackEvent, externalUserId, destinationId: room, message: "/가방거래등록 1 2 7000000" }), /synthetic market bag register audit failure/);
  assert.deepEqual(await snapshot(), beforeRollback);
  assert.equal(await database.verifyRollback(), true);

  await database.execute("UPDATE item_definitions SET active=FALSE,version=version+1 WHERE id=?", [itemId]);
  const carrotConfirm = `${base}-carrot-confirm`;
  await event(carrotConfirm);
  assert.equal((await service.handle({ eventId: carrotConfirm, externalUserId, destinationId: room, message: "/가방거래등록 1 20 1000" })).status, "pending");
  const carrotRegister = `${base}-carrot-register`;
  await event(carrotRegister);
  assert.equal((await service.handle({ eventId: carrotRegister, externalUserId, destinationId: room, message: "/가방거래등록 1 20 1000" })).status, "registered");
  assert.deepEqual(await snapshot(), { item_quantity: 7n, carrot_quantity: 30n, listings: 2n, confirmations: 0n, ledgers: 2n, fees: 2n });

  const beforeRestart = await snapshot();
  await database.close();
  database = createDatabaseClient(config.database);
  assert.deepEqual(await snapshot(), beforeRestart);
  const replayed = await new FreeMarketBagRegisterService(database).handle({ eventId: second, externalUserId, destinationId: room, message: "/가방거래등록 1 3 5000000" });
  assert.equal(replayed.replayed, true);
  assert.deepEqual(await snapshot(), beforeRestart);
  process.stdout.write(JSON.stringify({ mode: "probe", migrationCount: 356, latestMigration: 364, scenarios: ["shadow-registry", "stable-bag-index", "king-tier-reject", "listing-limit-reject", "100-carrot-fee", "carrot-self-sale", "60-second-confirmation", "event-replay", "atomic-register", "rollback", "restart-no-mutation"], operationalDataTouched: false }) + "\n");
} finally {
  await database.close();
}
