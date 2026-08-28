import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { DiamondShopReadService } from "../src/shop/diamond-shop-read-service.js";

test("MariaDB 다이아 상점 조회는 정렬·Shadow 무변경·재실행 방지를 보장한다", async (context) => {
  if (process.env.DATABASE_ENABLED !== "true") {
    context.skip("isolated diamond shop read database required");
    return;
  }
  const config = loadConfig();
  if (!config.database.enabled || !/^hoibot_diamond_shop_read(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
    context.skip("isolated diamond shop read database required");
    return;
  }
  const db = createDatabaseClient(config.database);
  const eventId = "iris:diamond-shop-read-integration";
  try {
    await db.execute("INSERT INTO players(id,status) VALUES (991200001,'active')");
    await db.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,status) VALUES (991200001,'kakao','diamond-reader','linked')");
    await db.execute("DELETE FROM diamond_shop_catalog_items");
    await db.execute("INSERT INTO diamond_shop_catalog_items(product_id,display_name,reward_quantity,diamond_price,display_order,enabled) VALUES ('00000000-0000-0000-0000-000000000912','두번째',2,20,2,TRUE),('00000000-0000-0000-0000-000000000911','첫번째',1,10,1,TRUE)");
    await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,'diamond-room','diamond-reader','message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3))", [eventId, eventId]);
    const before = await db.query<Array<{ currencies: bigint; inventories: bigint }>>("SELECT (SELECT COUNT(*) FROM currency_ledger) currencies,(SELECT COUNT(*) FROM inventory_ledger) inventories");
    const service = new DiamondShopReadService(db);
    const first = await service.handle({ eventId, externalUserId: "diamond-reader", destinationId: "diamond-room", message: "/다이아상점" });
    assert.ok(first);
    assert.ok(first.data.indexOf("1. 첫번째") < first.data.indexOf("2. 두번째"));
    const replay = await service.handle({ eventId, externalUserId: "diamond-reader", destinationId: "diamond-room", message: "/다이아상점" });
    assert.equal(replay?.replayed, true);
    const after = await db.query<Array<{ currencies: bigint; inventories: bigint; operations: bigint; audits: bigint }>>("SELECT (SELECT COUNT(*) FROM currency_ledger) currencies,(SELECT COUNT(*) FROM inventory_ledger) inventories,(SELECT COUNT(*) FROM operations WHERE idempotency_scope='diamond_shop.catalog_read') operations,(SELECT COUNT(*) FROM command_audit WHERE action_code='diamond_shop.catalog_read') audits");
    assert.deepEqual(after[0], { ...before[0]!, operations: 1n, audits: 1n });
    const rollout = await db.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='DIAMOND_SHOP_CATALOG_READ'");
    assert.equal(rollout[0]?.rollout_state, "SHADOW");
  } finally {
    await db.close();
  }
});
