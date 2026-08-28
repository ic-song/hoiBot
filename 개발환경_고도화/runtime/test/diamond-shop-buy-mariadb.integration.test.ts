import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { DiamondShopBuyService } from "../src/shop/diamond-shop-buy-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("diamond shop buy MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "diamond-shop-buy-token";
  const roomId = "990000000000640";
  const externalUserId = "diamond-shop-buy-user";
  const displayName = "합성 다이아 상품";
  const productId = "00000000-0000-4000-8000-000000000311";
  let playerId = "";
  let itemId = "";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='DIAMOND_SHOP_BUY'");
    const player = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    playerId = player.insertId.toString();
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [playerId, externalUserId, "합성 구매자"]);
    await database.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'diamond',100,1)", [playerId]);
    const item = await database.execute("INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,active,version) VALUES ('DIAMOND-SHOP-SYNTHETIC',?,'STACK',1,1,1)", [displayName]);
    itemId = item.insertId.toString();
    await database.execute("INSERT INTO diamond_shop_catalog_items(product_id,display_name,reward_quantity,diamond_price,display_order,enabled,version) VALUES (?,?,3,7,1,1,1)", [productId, displayName]);
  });

  after(async () => {
    if (!database) return;
    try { await database.close(); }
    catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("commits once, binds a stable item, rolls back on failure and survives service restart", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "diamond-shop-buy-pepper",
      DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"),
      DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    process.env.DIAMOND_SHOP_BUY_COMMAND_ENABLED = "true";
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (eventId: string, message: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg: message, room: "고도화팻테스트방", sender: "합성 구매자", json: { _id: eventId, chat_id: roomId, user_id: externalUserId } } });

    const eventId = `diamond-shop-buy-${Date.now()}`;
    assert.equal((await send(eventId, "/다이아상점구매 1 2")).statusCode, 202);
    assert.match(replies.at(-1)?.data ?? "", /구매 완료/);
    await send(eventId, "/다이아상점구매 1 2");
    const state = (await database.query<Array<{ balance: string; quantity: bigint; purchases: bigint; currency_ledgers: bigint; inventory_ledgers: bigint; bound_item: bigint }>>(
      `SELECT (SELECT CAST(balance AS CHAR) FROM currency_accounts WHERE player_id=? AND currency_code='diamond') balance,
        (SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=?) quantity,
        (SELECT COUNT(*) FROM diamond_shop_purchase_events WHERE player_id=? AND status_code='purchased') purchases,
        (SELECT COUNT(*) FROM currency_ledger WHERE player_id=? AND reason_code='DIAMOND_SHOP_PURCHASE') currency_ledgers,
        (SELECT COUNT(*) FROM inventory_ledger WHERE player_id=? AND reason_code='DIAMOND_SHOP_PURCHASE') inventory_ledgers,
        (SELECT reward_item_id FROM diamond_shop_catalog_items WHERE product_id=?) bound_item`,
      [playerId, playerId, itemId, playerId, playerId, playerId, productId]))[0]!;
    assert.deepEqual([state.balance, Number(state.quantity), Number(state.purchases), Number(state.currency_ledgers), Number(state.inventory_ledgers), state.bound_item.toString()], ["86.000", 6, 1, 1, 1, itemId]);

    const restarted = await new DiamondShopBuyService(database).handle({ eventId, externalUserId, destinationId: roomId, message: "/다이아상점구매 1 2" });
    assert.equal(restarted.status, "purchased");
    await database.execute("CREATE TRIGGER synthetic_diamond_shop_buy_failure BEFORE INSERT ON diamond_shop_purchase_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic purchase failure'");
    assert.equal((await send(`diamond-shop-rollback-${Date.now()}`, "/다이아상점구매 1 1")).statusCode, 500);
    await database.execute("DROP TRIGGER synthetic_diamond_shop_buy_failure");
    const afterRollback = (await database.query<Array<{ balance: string; quantity: bigint }>>(
      "SELECT (SELECT CAST(balance AS CHAR) FROM currency_accounts WHERE player_id=? AND currency_code='diamond') balance,(SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=?) quantity",
      [playerId, playerId, itemId]))[0]!;
    assert.deepEqual([afterRollback.balance, Number(afterRollback.quantity)], ["86.000", 6]);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='DIAMOND_SHOP_BUY'");
    await send(`diamond-shop-shadow-${Date.now()}`, "/다이아상점구매 1 1");
    const shadowBalance = (await database.query<Array<{ balance: string }>>("SELECT CAST(balance AS CHAR) balance FROM currency_accounts WHERE player_id=? AND currency_code='diamond'", [playerId]))[0]!;
    assert.equal(shadowBalance.balance, "86.000");
    await app.close();
  });
});
