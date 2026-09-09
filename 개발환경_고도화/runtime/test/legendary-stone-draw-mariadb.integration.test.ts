import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { LegendaryStoneDrawService } from "../src/shop/legendary-stone-draw-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("legendary stone draw MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "legendary-stone-draw-token", roomId = "990000000000581", suffix = Date.now().toString(), externalId = `legendary-draw-player-${suffix}`;
  let playerId = "";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='LEGENDARY_STONE_DRAW'");
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    playerId = player.id.toString();
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'합성 전돌 유저',1)", [player.id]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'합성 전돌 유저','linked')", [player.id, externalId]);
    const ticket = (await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code='ITEM-LEGENDARY-STONE-DRAW-TICKET'"))[0]!;
    await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,10,1)", [player.id, ticket.id]);
  });

  after(async () => {
    if (!database) return;
    try { await database.execute("DROP TRIGGER IF EXISTS fail_legendary_draw_outbox"); await database.close(); }
    catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; }
  });

  it("routes, rewards stable item codes, replays, shadows, rolls back and reconnects", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "legendary-stone-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    process.env.LEGENDARY_STONE_DRAW_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async reply => { replies.push(reply); } });
    const eventId = `legendary-app-${Date.now()}`, payload = { msg: "/전돌뽑기", room: "고도화운영테스트방", sender: "합성 전돌 유저", json: { _id: eventId, chat_id: roomId, user_id: externalId } };
    const originalRandom = Math.random;
    Math.random = () => 0.5;
    try { const active = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload }); assert.equal(active.statusCode, 202, active.body); }
    finally { Math.random = originalRandom; }
    assert.equal(replies.length, 2);
    assert.match(replies[0]!.data, /전설의돌 뽑기 결과/);
    assert.match(replies[1]!.data, /기본 지급 아이템/);

    const prepare = async (id: string) => database.execute("INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?,'iris',?,'message','test','incoming',REPEAT('d',64),'parsed','processing',UTC_TIMESTAMP(3))", [id, id]);
    const directId = `legendary-direct-${Date.now()}`;
    await prepare(directId);
    const service = new LegendaryStoneDrawService(database, () => 0, []);
    const direct = await service.execute({ eventId: directId, externalUserId: externalId, destinationId: roomId, message: "/전돌뽑기 2" });
    assert.equal(direct.status, "applied");
    assert.equal(direct.counts.stone50, "2");
    assert.equal(direct.counts.totalStone, "100");
    const quantities = await database.query<Array<{ code: string; quantity: bigint }>>(`SELECT item.code,stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code IN ('ITEM-LEGENDARY-STONE-DRAW-TICKET','ITEM-RWD-022','ITEM-RWD-053','ITEM-RWD-001','ITEM-RWD-052')`, [playerId]);
    const byCode = new Map(quantities.map(row => [row.code, row.quantity.toString()]));
    assert.equal(byCode.get("ITEM-LEGENDARY-STONE-DRAW-TICKET"), "7");
    assert.equal(byCode.get("ITEM-RWD-022"), "12");
    assert.equal(byCode.get("ITEM-RWD-053"), "3");
    assert.equal(byCode.get("ITEM-RWD-001"), "450");
    assert.equal(byCode.get("ITEM-RWD-052"), "101");
    const replay = await service.execute({ eventId: directId, externalUserId: externalId, destinationId: roomId, message: "/전돌뽑기 2" });
    assert.equal(replay.replayed, true);
    const samples = await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM legendary_stone_draw_rng_samples WHERE operation_id=(SELECT operation_id FROM command_executions WHERE event_id=?)", [directId]);
    assert.equal(Number(samples[0]!.count_value), 2);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='LEGENDARY_STONE_DRAW'");
    const beforeShadow = Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM legendary_stone_draw_operations"))[0]!.count_value);
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { ...payload, json: { ...payload.json, _id: `legendary-shadow-${Date.now()}` } } });
    const afterShadow = Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM legendary_stone_draw_operations"))[0]!.count_value);
    assert.equal(afterShadow, beforeShadow);

    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='LEGENDARY_STONE_DRAW'");
    const rollbackId = `legendary-rollback-${Date.now()}`;
    await prepare(rollbackId);
    const before = await database.query<Array<{ quantity: bigint }>>("SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code='ITEM-LEGENDARY-STONE-DRAW-TICKET'", [playerId]);
    await database.execute("CREATE TRIGGER fail_legendary_draw_outbox BEFORE INSERT ON outbox_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic legendary draw outbox failure'");
    await assert.rejects(() => service.execute({ eventId: rollbackId, externalUserId: externalId, destinationId: roomId, message: "/전돌뽑기" }), /synthetic legendary draw outbox failure/);
    await database.execute("DROP TRIGGER fail_legendary_draw_outbox");
    const afterRollback = await database.query<Array<{ quantity: bigint }>>("SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code='ITEM-LEGENDARY-STONE-DRAW-TICKET'", [playerId]);
    assert.equal(afterRollback[0]!.quantity.toString(), before[0]!.quantity.toString());
    const rollbackOp = await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM operations WHERE idempotency_scope='shop.legendary_stone.draw' AND idempotency_key=?", [rollbackId]);
    assert.equal(Number(rollbackOp[0]!.count_value), 0);

    delete process.env.LEGENDARY_STONE_DRAW_COMMAND_ENABLED;
    await app.close();
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 3, connectTimeoutMs: 5_000 });
    const reconnected = await new LegendaryStoneDrawService(database, () => 0, []).execute({ eventId: directId, externalUserId: externalId, destinationId: roomId, message: "/전돌뽑기 2" });
    assert.equal(reconnected.replayed, true);
  });
});
