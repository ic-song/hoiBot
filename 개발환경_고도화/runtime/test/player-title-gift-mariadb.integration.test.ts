import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string) => process.env[name] ?? "integration-not-configured";

describe("player title gift MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "player-title-gift-token", roomId = "990000000000235", actorExternalId = "title-gift-actor";
  const open = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5000 });

  before(async () => {
    database = open();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='PLAYER_TITLE_GIFT'");
    await database.execute("INSERT INTO players(status,version) VALUES('active',1),('active',1)");
    const players = await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 2");
    const target = players[0]!, actor = players[1]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES(?,'받는회원',1),(?,'보낸회원',1)", [target.id, actor.id]);
    await database.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES(?,'🌟',1),(?,'⭐',2)", [target.id, actor.id]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES(?,'kakao',?,'보낸회원','linked')", [actor.id, actorExternalId]);
    const item = (await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code='legacy-title-gift-ticket'"))[0]!;
    await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES(?,?,3,1)", [actor.id, item.id]);
  });

  after(async () => { if (database) try { await database.close(); } catch {} });

  it("creates and selects once, replays, rolls back, shadows and reconnects", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "player-title-gift-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const dependencies = { database, inspectIrisChannel: async () => ({ mode: "operational" as const, channelClass: "open_group" as const, reason: "allowed" as const, evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply: { room: string; data: string }) => { replies.push(reply); } };
    let app = buildApp(config, dependencies);
    let send = (id: string, message: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화팻테스트방", sender: "보낸회원", json: { _id: id, chat_id: roomId, user_id: actorExternalId } } });
    const eventId = `title-gift-${Date.now()}`;
    assert.equal((await send(eventId, "/타이틀선물 받는회원 선물 타이틀")).statusCode, 202);
    assert.match(replies.at(-1)!.data, /\[선물 타이틀\] 로 적용되었습니다/);
    await send(eventId, "/타이틀선물 받는회원 선물 타이틀");
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM command_executions WHERE command_code='PLAYER_TITLE_GIFT'"))[0]!.count_value), 1);
    assert.equal((await database.query<Array<{ quantity: bigint }>>("SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE item.code='legacy-title-gift-ticket'"))[0]!.quantity, 2n);

    const beforeShadow = replies.length;
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='PLAYER_TITLE_GIFT'");
    await send(`shadow-${Date.now()}`, "/타이틀선물 받는회원 그림자 타이틀");
    assert.equal(replies.length, beforeShadow);
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='PLAYER_TITLE_GIFT'");

    await database.execute("CREATE TRIGGER synthetic_title_gift_audit_failure BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic audit failure'");
    assert.equal((await send(`failed-${Date.now()}`, "/타이틀선물 받는회원 실패 타이틀")).statusCode, 500);
    await database.execute("DROP TRIGGER synthetic_title_gift_audit_failure");
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM title_definitions WHERE display_name='실패 타이틀'"))[0]!.count_value), 0);

    await app.close(); database = open(); app = buildApp(config, { ...dependencies, database });
    send = (id, message) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화팻테스트방", sender: "보낸회원", json: { _id: id, chat_id: roomId, user_id: actorExternalId } } });
    assert.equal((await send(`reconnect-${Date.now()}`, "/타이틀선물 받는회원 재접속 타이틀")).statusCode, 202);
    assert.match(replies.at(-1)!.data, /재접속 타이틀/);
    await app.close();
  });
});
