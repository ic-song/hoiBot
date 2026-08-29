import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { createInventoryWalletRngSeed, inventoryWalletRngSample, InventoryWalletRngOpenService } from "../src/inventory/inventory-wallet-rng-open-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_wallet_rng(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic wallet RNG probe blocked: ${config.database.name}`);
const base = process.env.INVENTORY_WALLET_RNG_PROBE_EVENT_ID ?? "inventory-wallet-rng-g7-20260830-r1";
const restart = process.argv.includes("--verify-restart");
const db = createDatabaseClient(config.database);
const room = "synthetic-wallet-rng-room", actor = "wallet-rng-actor", playerId = 997000000n;

async function event(id: string): Promise<void> {
  await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('w',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [id, id, room, actor]);
}
function failAudit(inner: DatabaseClient): DatabaseClient {
  return { ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params), verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction(transaction => work({ query: (sql, params) => transaction.query(sql, params), execute: async (sql, params) => { if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic wallet RNG audit failure"); return transaction.execute(sql, params); } })) };
}
async function snapshot(): Promise<Array<{ quantity: bigint; point: string; rolls: bigint; operations: bigint; inventory_ledgers: bigint; currency_ledgers: bigint; outboxes: bigint }>> {
  return db.query(`SELECT
    (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=${playerId} AND item.code='ITEM-HOI-WALLET') quantity,
    (SELECT CAST(balance AS CHAR) FROM currency_accounts WHERE player_id=${playerId} AND currency_code='point') point,
    (SELECT COUNT(*) FROM inventory_wallet_rng_rolls roll JOIN operations operation ON operation.id=roll.operation_id WHERE operation.idempotency_scope='inventory.wallet_rng_open') rolls,
    (SELECT COUNT(*) FROM operations WHERE idempotency_scope='inventory.wallet_rng_open') operations,
    (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation ON operation.id=ledger.operation_id WHERE operation.idempotency_scope='inventory.wallet_rng_open') inventory_ledgers,
    (SELECT COUNT(*) FROM currency_ledger ledger JOIN operations operation ON operation.id=ledger.operation_id WHERE operation.idempotency_scope='inventory.wallet_rng_open') currency_ledgers,
    (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope='inventory.wallet_rng_open') outboxes`);
}
async function successEvent(): Promise<string> {
  const row = (await db.query<Array<{ content_hash: string }>>("SELECT content_hash FROM inventory_wallet_rng_config_versions WHERE id=940000001"))[0]!;
  for (let attempt = 0; attempt < 10000; attempt++) {
    const id = `${base}-success-${attempt}`, seed = createInventoryWalletRngSeed(row.content_hash, id, playerId.toString(), 3n);
    if ([1n, 2n, 3n].some(ordinal => inventoryWalletRngSample(seed, ordinal, "empty") >= 0.7)) return id;
  }
  throw new Error("deterministic wallet success event not found");
}

try {
  const success = await successEvent();
  if (restart) {
    const before = await snapshot();
    const replay = await new InventoryWalletRngOpenService(db).execute({ eventId: success, externalUserId: actor, destinationId: room, message: "/지갑털기 3" });
    assert.equal(replay.replayed, true); assert.deepEqual(await snapshot(), before);
    process.stdout.write(JSON.stringify({ mode: "verify-restart", additionalMutation: false, operationalDataTouched: false }) + "\n");
  } else {
    await db.execute("INSERT INTO players(id,status) VALUES (?,'active')", [playerId]);
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,'지갑검증자')", [playerId]);
    await db.execute("INSERT INTO external_identities(id,provider_code,external_user_id,player_id,status) VALUES (997100000,'kakao',?,?,'linked')", [actor, playerId]);
    await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT ?,id,10,1 FROM item_definitions WHERE code='ITEM-HOI-WALLET'", [playerId]);
    await db.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',100,1)", [playerId]);
    const registry = (await db.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='INVENTORY_WALLET_RNG_OPEN'"))[0];
    assert.equal(registry?.rollout_state, "SHADOW");
    const tiers = await db.query<Array<{ tier_ordinal: number; weight_value: bigint; payout_amount: bigint }>>("SELECT tier_ordinal,weight_value,payout_amount FROM inventory_wallet_rng_payout_tiers WHERE config_version_id=940000001 ORDER BY tier_ordinal");
    assert.deepEqual(tiers.map(row => [row.tier_ordinal, row.weight_value.toString(), row.payout_amount.toString()]), [[1,"82000000","10000000"],[2,"14000000","30000000"],[3,"3500000","50000000"],[4,"400000","100000000"],[5,"90000","300000000"],[6,"10000","1000000000"]]);
    const rollbackEvent = `${base}-rollback`; await event(rollbackEvent); const beforeRollback = await snapshot();
    await assert.rejects(() => new InventoryWalletRngOpenService(failAudit(db)).execute({ eventId: rollbackEvent, externalUserId: actor, destinationId: room, message: "/지갑털기 2" }), /synthetic wallet RNG audit failure/);
    assert.deepEqual(await snapshot(), beforeRollback); assert.equal(await db.verifyRollback(), true);
    await event(success);
    const [first, concurrent] = await Promise.all([
      new InventoryWalletRngOpenService(db).execute({ eventId: success, externalUserId: actor, destinationId: room, message: "/지갑털기 3" }),
      new InventoryWalletRngOpenService(db).execute({ eventId: success, externalUserId: actor, destinationId: room, message: "/지갑털기 3" })
    ]);
    assert.equal(first.status, "success"); assert.equal(concurrent.status, "success"); assert.ok(first.replayed === true || concurrent.replayed === true);
    const effects = (await snapshot())[0]!;
    assert.equal(effects.quantity, 7n); assert.equal(effects.rolls, 3n); assert.equal(effects.operations, 1n); assert.equal(effects.inventory_ledgers, 1n); assert.equal(effects.currency_ledgers, 1n); assert.ok(BigInt(effects.point.split('.')[0]!) > 100n);
    const samples = await db.query<Array<{ first_sample: string; second_sample: string | null; result_code: string }>>("SELECT CAST(first_sample AS CHAR) first_sample,CAST(second_sample AS CHAR) second_sample,result_code FROM inventory_wallet_rng_rolls ORDER BY roll_ordinal");
    assert.ok(samples.some(row => row.result_code === "payout" && row.second_sample !== null)); assert.ok(samples.every(row => row.result_code === "payout" || row.second_sample === null));
    process.stdout.write(JSON.stringify({ mode: "probe", scenarios: ["v2.400-config", "shadow-registry", "rollback", "deterministic-two-stage-rng", "inventory-currency-atomic", "same-event-concurrency", "ordered-batch-output"], effects, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
  }
} finally { await db.close(); }
