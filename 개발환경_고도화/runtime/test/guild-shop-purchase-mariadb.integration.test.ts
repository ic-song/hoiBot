import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { GuildShopPurchaseService } from "../src/guild/guild-shop-purchase-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("guild shop purchase MariaDB", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const externalId = `guild-shop-purchase-${Date.now()}`;
  const productId = "42700000-0000-4000-8000-000000000001";
  const open = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });

  before(async () => {
    database = open();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=TRUE WHERE command_code='GUILD_SHOP_PURCHASE'");
    await database.execute("INSERT INTO guilds(code,display_name,status) VALUES (?,?, 'active')", [`guild-shop-${Date.now()}`, "합성성주길드"]);
    const guild = (await database.query<Array<{ id: bigint }>>("SELECT id FROM guilds WHERE display_name='합성성주길드' ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'합성구매회원',1)", [player.id]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'합성구매회원','linked')", [player.id, externalId]);
    await database.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at) VALUES (?,?,'member',UTC_TIMESTAMP(3))", [guild.id, player.id]);
    await database.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',5000,1)", [player.id]);
    await database.execute("INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES ('guild_shop_purchase_fixture','합성길드상품','ITEM',TRUE,JSON_OBJECT('source','synthetic'),TRUE,1)");
    const item = (await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code='guild_shop_purchase_fixture'"))[0]!;
    await database.execute("INSERT INTO guild_shop_items(product_id,item_id,display_name,price,daily_limit,display_order,enabled,version) VALUES (?,?, '합성길드상품',1000,2,1,TRUE,1)", [productId, item.id]);
    await database.execute("UPDATE castle_state SET tax_rate_basis_points=1000,lord_guild_name='합성성주길드',version=version+1 WHERE state_code='HOI_CASTLE'");
    for (const eventId of ["guild-shop-purchase-first", "guild-shop-purchase-rollback", "guild-shop-purchase-shadow"]) await database.execute("INSERT INTO event_inbox(event_id,event_kind,processing_status,received_at,attempt_count) VALUES (?,'iris','processing',UTC_TIMESTAMP(3),1)", [eventId]);
  });

  after(async () => { if (database !== undefined) await database.close(); });

  it("keeps purchase, tax split, replay, rollback, reconnect and Shadow atomic", async () => {
    const service = new GuildShopPurchaseService(database);
    const first = await service.handle({ externalUserId: externalId, channelId: "427-room", message: "/길드상점구매 1 2", eventId: "guild-shop-purchase-first" });
    assert.equal(first?.totalPrice, "2200");
    assert.equal(first?.balanceAfter, "2800");
    assert.equal((await service.handle({ externalUserId: externalId, channelId: "427-room", message: "/길드상점구매 1 2", eventId: "guild-shop-purchase-first" }))?.replayed, true);
    const purchase = (await database.query<Array<{ guild_fund_amount: string; foundation_amount: string }>>("SELECT CAST(guild_fund_amount AS CHAR) guild_fund_amount,CAST(foundation_amount AS CHAR) foundation_amount FROM guild_shop_purchases WHERE product_id=?", [productId]))[0]!;
    assert.equal(BigInt(purchase.guild_fund_amount), 30n);
    assert.equal(BigInt(purchase.foundation_amount), 170n);
    await database.execute("UPDATE guild_shop_items SET daily_limit=NULL WHERE product_id=?", [productId]);
    await database.execute("CREATE TRIGGER fail_guild_shop_purchase_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic guild purchase rollback'");
    await assert.rejects(service.handle({ externalUserId: externalId, channelId: "427-room", message: "/길드상점구매 1", eventId: "guild-shop-purchase-rollback" }));
    await database.execute("DROP TRIGGER fail_guild_shop_purchase_audit");
    const balance = (await database.query<Array<{ balance: string }>>("SELECT CAST(balance AS CHAR) balance FROM currency_accounts account JOIN external_identities identity ON identity.player_id=account.player_id WHERE identity.external_user_id=? AND account.currency_code='point'", [externalId]))[0]!;
    assert.equal(Number(balance.balance), 2800);
    await database.close();
    database = open();
    assert.equal((await new GuildShopPurchaseService(database).handle({ externalUserId: externalId, channelId: "427-room", message: "/길드상점구매 1 2", eventId: "guild-shop-purchase-first" }))?.replayed, true);
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='GUILD_SHOP_PURCHASE'");
    assert.equal(await new GuildShopPurchaseService(database).handle({ externalUserId: externalId, channelId: "427-room", message: "/길드상점구매 1", eventId: "guild-shop-purchase-shadow" }), null);
  });
});
