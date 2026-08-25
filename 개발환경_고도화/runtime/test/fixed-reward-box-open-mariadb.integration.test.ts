import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("fixed reward box open MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  let playerId: bigint;
  const token = "fixed-reward-box-token";
  const externalId = `fixed-box-user-${Date.now()}`;
  const roomId = "990000000000263";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE handler_key='inventory_fixed_reward_box_open'");
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    playerId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!.id;
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'고정박스 합성 사용자','linked')", [playerId, externalId]);
    const items = await database.query<Array<{ id: bigint; code: string }>>(
      "SELECT id,code FROM item_definitions WHERE code IN ('ITEM-DUNGEON-CHICKEN-BOX','ITEM-DUNGEON-SHOP-OPEN-BOX','ITEM-PACKAGE-CHICKEN-BOX','ITEM-RWD-001')"
    );
    for (const [code, quantity] of [["ITEM-DUNGEON-CHICKEN-BOX", 3], ["ITEM-DUNGEON-SHOP-OPEN-BOX", 2]] as const) {
      const item = items.find((row) => row.code === code)!;
      await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1)", [playerId, item.id, quantity]);
    }
  });

  after(async () => {
    if (!database) return;
    try { await database.close(); } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("opens both seeded rules, clamps, replays, routes Shadow and rolls back ledger failure", async () => {
    const replies: string[] = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "fixed-box-pepper",
      DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
      DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply.data); } });
    const send = async (eventId: string, message: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg: message, room: "고도화고정박스방", sender: "합성 사용자", json: { _id: eventId, chat_id: roomId, user_id: externalId } } });

    const baselineLedgers = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM inventory_ledger WHERE reason_code LIKE 'fixed_reward_box_open_%'");
    const chickenEvent = `fixed-chicken-${Date.now()}`;
    assert.equal((await send(chickenEvent, "/양계장박스오픈 9")).statusCode, 202);
    assert.match(replies.at(-1)!, /치킨상자🐔 30개/);
    await send(chickenEvent, "/양계장박스오픈 9");
    let ledgers = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM inventory_ledger WHERE reason_code LIKE 'fixed_reward_box_open_%'");
    assert.equal(Number(ledgers[0]!.count), Number(baselineLedgers[0]!.count) + 2);

    assert.equal((await send(`fixed-shop-${Date.now()}`, "/샵오픈박스오픈")).statusCode, 202);
    assert.match(replies.at(-1)!, /70개/);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='INVENTORY_SHOP_OPEN_DUNGEON_BOX_OPEN'");
    const shadowEvent = `fixed-shadow-${Date.now()}`;
    await send(shadowEvent, "/샵오픈박스오픈");
    const route = (await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${shadowEvent}`]))[0]!;
    assert.equal(route.route, "SHADOW");

    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='INVENTORY_SHOP_OPEN_DUNGEON_BOX_OPEN'");
    await database.execute("CREATE TRIGGER synthetic_fixed_box_ledger_failure BEFORE INSERT ON inventory_ledger FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic fixed box ledger failure'");
    const failed = await send(`fixed-failed-${Date.now()}`, "/샵오픈박스오픈");
    assert.equal(failed.statusCode, 500);
    await database.execute("DROP TRIGGER synthetic_fixed_box_ledger_failure");
    const source = (await database.query<Array<{ quantity: bigint }>>(
      "SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code='ITEM-DUNGEON-SHOP-OPEN-BOX'", [playerId]))[0]!;
    assert.equal(Number(source.quantity), 1);
    await app.close();
  });
});
