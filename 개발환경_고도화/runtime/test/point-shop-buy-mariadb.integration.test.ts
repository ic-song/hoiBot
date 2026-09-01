import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { PointShopBuyService } from "../src/shop/point-shop-buy-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("point shop buy MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  let playerId = "";
  const externalUserId = "990000000000428";
  const destinationId = "990000000000429";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    const player = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    playerId = player.insertId.toString();
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,tier_code) VALUES (?,'합성 포인트 구매자','normal')", [playerId]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'합성 포인트 구매자','linked')", [playerId, externalUserId]);
    await database.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',100000000000,1)", [playerId]);
    await database.execute("INSERT INTO player_pets(player_id,display_name,pet_type_code,image_value,personality_label,version) VALUES (?,'합성펫','legacy-sky','🐦','다정한',1)", [playerId]);
  });

  after(async () => {
    try { await database.close(); }
    catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  const receive = async (eventId: string): Promise<void> => {
    await database.execute("INSERT INTO event_inbox(event_id,event_kind,processing_status,received_at) VALUES (?,'message','processing',UTC_TIMESTAMP(3))", [`iris:${eventId}`]);
  };

  it("commits stack and pet effects once, enforces limits, and rolls back failures", async () => {
    const service = new PointShopBuyService(database, () => 0);
    const stackEvent = `point-shop-stack-${Date.now()}`;
    await receive(stackEvent);
    const stack = await service.handle({ eventId: stackEvent, externalUserId, destinationId, message: "/구매 2 3" });
    assert.equal(stack.status, "purchased");
    const replay = await new PointShopBuyService(database, () => 0.9).handle({ eventId: stackEvent, externalUserId, destinationId, message: "/구매 2 3" });
    assert.equal(replay.replayed, true);
    const petEvent = `point-shop-pet-${Date.now()}`;
    await receive(petEvent);
    const personality = await service.handle({ eventId: petEvent, externalUserId, destinationId, message: "/구매 4" });
    assert.equal(personality.status, "purchased");
    const limitEvent = `point-shop-limit-${Date.now()}`;
    await receive(limitEvent);
    const limited = await service.handle({ eventId: limitEvent, externalUserId, destinationId, message: "/구매 8 2" });
    assert.equal(limited.status, "quantity_limit");
    const state = (await database.query<Array<{ balance: string; stack_quantity: bigint; personality_label: string; purchases: bigint; ledgers: bigint }>>(
      `SELECT CAST((SELECT balance FROM currency_accounts WHERE player_id=? AND currency_code='point') AS CHAR) balance,
       (SELECT stack.quantity FROM inventory_stacks stack JOIN point_shop_catalog product ON product.reward_item_id=stack.item_id WHERE stack.player_id=? AND product.product_id='point-shop-castle-coin') stack_quantity,
       (SELECT personality_label FROM player_pets WHERE player_id=?) personality_label,
       (SELECT COUNT(*) FROM point_shop_purchase_events WHERE player_id=? AND result_code='purchased') purchases,
       (SELECT COUNT(*) FROM currency_ledger WHERE player_id=? AND reason_code='POINT_SHOP_PURCHASE') ledgers`, [playerId,playerId,playerId,playerId,playerId]))[0]!;
    assert.deepEqual([Number(state.stack_quantity),state.personality_label,Number(state.purchases),Number(state.ledgers)], [3,"다정한",2,2]);
    await database.execute("CREATE TRIGGER synthetic_point_shop_failure BEFORE INSERT ON point_shop_purchase_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic point shop failure'");
    const rollbackEvent = `point-shop-rollback-${Date.now()}`;
    await receive(rollbackEvent);
    await assert.rejects(() => service.handle({ eventId: rollbackEvent, externalUserId, destinationId, message: "/구매 3" }), /synthetic point shop failure/);
    await database.execute("DROP TRIGGER synthetic_point_shop_failure");
    const after = (await database.query<Array<{ balance: string }>>("SELECT CAST(balance AS CHAR) balance FROM currency_accounts WHERE player_id=? AND currency_code='point'", [playerId]))[0]!;
    assert.equal(after.balance, state.balance);

    const token = "point-shop-buy-shadow-token";
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "point-shop-buy-shadow-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    process.env.POINT_SHOP_BUY_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async () => {} });
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW',enabled=1 WHERE command_code='POINT_SHOP_BUY'");
    const shadowEvent = `point-shop-shadow-${Date.now()}`;
    const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: "/구매 2 1", room: "고도화팻테스트방", sender: "합성 포인트 구매자", json: { _id: shadowEvent, chat_id: destinationId, user_id: externalUserId } } });
    assert.equal(response.statusCode, 202);
    const shadow = (await database.query<Array<{ balance: string; route: string }>>(
      "SELECT CAST((SELECT balance FROM currency_accounts WHERE player_id=? AND currency_code='point') AS CHAR) balance,(SELECT route FROM command_routing_decisions WHERE event_id=?) route",
      [playerId, `iris:${shadowEvent}`]))[0]!;
    assert.deepEqual([shadow.balance, shadow.route], [state.balance, "SHADOW"]);
    await app.close();
    delete process.env.POINT_SHOP_BUY_COMMAND_ENABLED;
    delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
  });
});
