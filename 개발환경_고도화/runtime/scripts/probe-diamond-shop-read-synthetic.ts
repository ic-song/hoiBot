import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { DiamondShopReadService } from "../src/shop/diamond-shop-read-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_diamond_shop_read(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic diamond shop read probe blocked: ${config.database.name}`);
const base = process.env.DIAMOND_SHOP_READ_PROBE_EVENT_ID ?? "diamond-shop-read-g7-20260828-r1";
const restart = process.argv.includes("--verify-restart");
const db = createDatabaseClient(config.database);
const service = new DiamondShopReadService(db);
const canonical = (value: string): string => value.startsWith("iris:") ? value : `iris:${value}`;
async function event(id: string): Promise<void> { const key = canonical(id); await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,'diamond-probe-room','diamond-probe-user','message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [key, key]); }
function failAudit(inner: DatabaseClient): DatabaseClient { return { ping: () => inner.ping(), query: (s, p) => inner.query(s, p), execute: (s, p) => inner.execute(s, p), verifyRollback: () => inner.verifyRollback(), close: async () => undefined, withTransaction: <T>(work: (t: DatabaseTransaction) => Promise<T>) => inner.withTransaction((t) => work({ query: (s, p) => t.query(s, p), execute: async (s, p) => { if (s.includes("INSERT INTO command_audit")) throw new Error("synthetic diamond shop read audit failure"); return t.execute(s, p); } })) }; }

try {
  const success = `${base}-success`;
  if (restart) {
    const before = await db.query<Array<{ ops: bigint; outboxes: bigint }>>("SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='diamond_shop.catalog_read' AND idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes", [canonical(success), canonical(success)]);
    await service.handle({ eventId: success, externalUserId: "diamond-probe-user", destinationId: "diamond-probe-room", message: "/다이아상점" });
    const after = await db.query<Array<{ ops: bigint; outboxes: bigint }>>("SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='diamond_shop.catalog_read' AND idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes", [canonical(success), canonical(success)]);
    assert.deepEqual(after, before); assert.deepEqual(after[0], { ops: 1n, outboxes: 1n });
    process.stdout.write(JSON.stringify({ mode: "verify-restart", operationCount: 1, outboxCount: 1, additionalMutation: false, operationalDataTouched: false }) + "\n");
  } else {
    await db.execute("INSERT INTO players(id,status) VALUES (991200002,'active')");
    await db.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,status) VALUES (991200002,'kakao','diamond-probe-user','linked')");
    await db.execute("DELETE FROM diamond_shop_catalog_items");
    await db.execute("INSERT INTO diamond_shop_catalog_items(product_id,display_name,reward_quantity,diamond_price,display_order,enabled) VALUES ('00000000-0000-0000-0000-000000000922','후순위',3,30,2,TRUE),('00000000-0000-0000-0000-000000000921','선순위',2,20,1,TRUE)");
    await event(success);
    const result = await service.handle({ eventId: success, externalUserId: "diamond-probe-user", destinationId: "diamond-probe-room", message: "/다이아상점" });
    assert.ok(result && result.data.indexOf("1. 선순위") < result.data.indexOf("2. 후순위"));
    const replay = await service.handle({ eventId: success, externalUserId: "diamond-probe-user", destinationId: "diamond-probe-room", message: "/다이아상점" });
    assert.equal(replay?.replayed, true);
    const rollback = `${base}-rollback`; await event(rollback);
    await assert.rejects(() => new DiamondShopReadService(failAudit(db)).handle({ eventId: rollback, externalUserId: "diamond-probe-user", destinationId: "diamond-probe-room", message: "/다이아상점" }), /synthetic diamond shop read audit failure/);
    const effects = await db.query<Array<{ ops: bigint; outboxes: bigint; rollbackOps: bigint; currencies: bigint; inventories: bigint }>>("SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='diamond_shop.catalog_read' AND idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes,(SELECT COUNT(*) FROM operations WHERE idempotency_key=?) rollbackOps,(SELECT COUNT(*) FROM currency_ledger) currencies,(SELECT COUNT(*) FROM inventory_ledger) inventories", [canonical(success), canonical(success), canonical(rollback)]);
    assert.deepEqual(effects[0], { ops: 1n, outboxes: 1n, rollbackOps: 0n, currencies: 0n, inventories: 0n });
    assert.equal(await db.verifyRollback(), true);
    process.stdout.write(JSON.stringify({ mode: "probe", scenarios: ["shadow-registry", "stable-order", "exact-guard", "replay", "rollback", "no-ledger-mutation"], effects: effects[0], operationalDataTouched: false }, (_, value) => typeof value === "bigint" ? Number(value) : value) + "\n");
  }
} finally { await db.close(); }
