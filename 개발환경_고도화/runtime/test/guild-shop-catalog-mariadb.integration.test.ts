import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { GuildShopCatalogService } from "../src/guild/guild-shop-catalog-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("guild shop catalog MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "guild-shop-token", roomId = "990000000000629";
  const adminExternalId = "guild-shop-admin", userExternalId = "guild-shop-user";
  const open = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });

  before(async () => {
    database = open();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE handler_key='guild_shop_catalog'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES ('guild-shop-op','길드상점 관리자','synthetic','active')");
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id='guild-shop-op'"))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='super_admin'"))[0]!;
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    for (const fixture of [{ externalId: adminExternalId, name: "길드상점 관리자" }, { externalId: userExternalId, name: "길드상점 사용자" }]) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [player.id, fixture.name]);
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, fixture.externalId, fixture.name]);
      if (fixture.externalId === adminExternalId) {
        const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [fixture.externalId]))[0]!;
        await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
      }
    }
  });

  after(async () => { if (!database) return; try { await database.close(); } catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; } });

  it("preserves stable IDs, index deletion, permission, replay, rollback, restart and Shadow", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "guild-shop-pepper", PARTIAL_COMMAND_DISPATCH_ENABLED: "true", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (externalId: string, eventId: string, msg: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg, room: "고도화팻테스트방", sender: externalId, json: { _id: eventId, chat_id: roomId, user_id: externalId } } });

    const addEvent = "guild-shop-add";
    assert.equal((await send(adminExternalId, addEvent, "/길드상점추가 길드메달, 1200")).statusCode, 202);
    await send(adminExternalId, addEvent, "/길드상점추가 길드메달, 1200");
    const added = (await database.query<Array<{ product_id: string; price: string; daily_limit: number; version: bigint }>>("SELECT product_id,price,daily_limit,version FROM guild_shop_items WHERE display_name='길드메달'"))[0]!;
    assert.equal(BigInt(added.price), 1200n); assert.equal(added.daily_limit, 1); assert.equal(added.version, 1n);
    assert.equal((await send(adminExternalId, "guild-shop-update", "/길드상점추가 길드메달, 1500")).statusCode, 202);
    const updated = (await database.query<Array<{ product_id: string; price: string; version: bigint }>>("SELECT product_id,price,version FROM guild_shop_items WHERE display_name='길드메달'"))[0]!;
    assert.equal(updated.product_id, added.product_id); assert.equal(BigInt(updated.price), 1500n); assert.equal(updated.version, 2n);
    await send(userExternalId, "guild-shop-list", "/길드상점");
    assert.match(replies.at(-1)?.data ?? "", /길드메달 : 1,500 Point/);
    await send(userExternalId, "guild-shop-denied", "/길드상점추가 금지상품, 10");
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM guild_shop_items WHERE display_name='금지상품'"))[0]!.count, 0n);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='GUILD_SHOP_ADD'");
    await send(adminExternalId, "guild-shop-shadow", "/길드상점추가 그림자상품, 10");
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM guild_shop_items WHERE display_name='그림자상품'"))[0]!.count, 0n);
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='GUILD_SHOP_ADD'");

    await database.execute("CREATE TRIGGER fail_guild_shop_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic guild shop rollback'");
    const rollbackEvent = "guild-shop-rollback";
    assert.equal((await send(adminExternalId, rollbackEvent, "/길드상점추가 롤백상품, 10")).statusCode, 500);
    await database.execute("DROP TRIGGER fail_guild_shop_audit");
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM guild_shop_items WHERE display_name='롤백상품'"))[0]!.count, 0n);
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM operations WHERE idempotency_key=?", [`iris:${rollbackEvent}`]))[0]!.count, 0n);

    const deleteEvent = "guild-shop-delete";
    await send(adminExternalId, deleteEvent, "/길드상점삭제 1");
    assert.equal((await database.query<Array<{ enabled: number }>>("SELECT enabled FROM guild_shop_items WHERE product_id=?", [added.product_id]))[0]!.enabled, 0);
    await app.close();
    try { await database.close(); } catch { /* app may already own the injected pool */ }
    database = open();
    const replay = await new GuildShopCatalogService(database).handle({ externalUserId: adminExternalId, channelId: roomId, message: "/길드상점삭제 1", eventId: `iris:${deleteEvent}` });
    assert.equal(replay?.replayed, true);
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM guild_shop_catalog_events WHERE product_id=?", [added.product_id]))[0]!.count, 3n);
  });
});
