import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string) => process.env[name] ?? "integration-not-configured";

describe("player title read MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "player-title-read-token";
  const roomId = "990000000000234";
  const externalId = "title-read-requester";
  const open = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5000 });

  before(async () => {
    database = open();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code IN('PLAYER_TITLE_LIST_READ','PLAYER_TITLE_INFO_READ')");
    await database.execute("INSERT INTO players(status,version) VALUES('active',1),('active',1)");
    const players = await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 2");
    const target = players[0]!.id;
    const actor = players[1]!.id;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES(?,'조회회원',1),(?,'대상회원',1)", [actor, target]);
    await database.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES(?,'⭐',1),(?,'🌙',2)", [actor, target]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES(?,'kakao',?,'조회회원','linked')", [actor, externalId]);
    const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE external_user_id=?", [externalId]))[0]!;
    await database.execute("INSERT INTO player_title_read_delegates(external_identity_id,active) VALUES(?,TRUE)", [identity.id]);
    await database.execute("INSERT INTO title_definitions(code,display_name,scope_code,active) VALUES('title_read_first','첫 번째','player',TRUE),('title_read_second','두 번째','player',TRUE)");
    const titles = await database.query<Array<{ id: bigint; code: string }>>("SELECT id,code FROM title_definitions WHERE code IN('title_read_first','title_read_second') ORDER BY code");
    const first = titles.find((title) => title.code === "title_read_first")!;
    const second = titles.find((title) => title.code === "title_read_second")!;
    await database.execute("INSERT INTO player_titles(player_id,title_id,acquired_at,equipped,display_order,acquisition_price) VALUES(?,?,'2026-08-27 14:00:00',FALSE,1,9999),(?,?,'2026-08-27 14:10:00',TRUE,2,15000),(?,?,'2026-08-27 14:20:00',TRUE,1,25000)", [actor, first.id, actor, second.id, target, first.id]);
  });

  after(async () => { if (database) try { await database.close(); } catch (error) { if (!(typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ER_POOL_ALREADY_CLOSED")) throw error; } });

  it("reads self, delegated target and info, replays, rolls back, shadows and reconnects", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "player-title-read-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const dependencies = { database, inspectIrisChannel: async () => ({ mode: "operational" as const, channelClass: "open_group" as const, reason: "allowed" as const, evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply: { room: string; data: string }) => { replies.push(reply); } };
    let app = buildApp(config, dependencies);
    let send = (id: string, message: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화팻테스트방", sender: "조회회원", json: { _id: id, chat_id: roomId, user_id: externalId } } });

    assert.equal((await send(`self-${Date.now()}`, "/타이틀목록")).statusCode, 202);
    assert.match(replies.at(-1)!.data, /☞ 2\. 두 번째/);
    assert.equal((await send(`target-${Date.now()}`, "/타이틀목록 대상회원추가")).statusCode, 202);
    assert.match(replies.at(-1)!.data, /\[🌙대상회원\]님의 타이틀 목록/);
    assert.match(replies.at(-1)!.data, /가격: 🅟25,000/);

    const infoEvent = `info-${Date.now()}`;
    assert.equal((await send(infoEvent, "/타이틀정보 2")).statusCode, 202);
    assert.match(replies.at(-1)!.data, /\[두 번째\] 상세정보/);
    assert.match(replies.at(-1)!.data, /획득일:2026-08-27 23:10/);
    assert.match(replies.at(-1)!.data, /판매가: 🅟4,500/);
    await send(infoEvent, "/타이틀정보 2");
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM command_executions WHERE command_code='PLAYER_TITLE_INFO_READ'"))[0]!.count_value), 1);

    const beforeShadow = replies.length;
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='PLAYER_TITLE_LIST_READ'");
    await send(`shadow-${Date.now()}`, "/타이틀목록");
    assert.equal(replies.length, beforeShadow);
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='PLAYER_TITLE_LIST_READ'");

    const outboxBefore = Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM outbox_messages"))[0]!.count_value);
    await database.execute("CREATE TRIGGER synthetic_title_read_audit_failure BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic audit failure'");
    assert.equal((await send(`failed-${Date.now()}`, "/타이틀정보 1")).statusCode, 500);
    await database.execute("DROP TRIGGER synthetic_title_read_audit_failure");
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM outbox_messages"))[0]!.count_value), outboxBefore);

    await app.close();
    database = open();
    app = buildApp(config, { ...dependencies, database });
    send = (id, message) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화팻테스트방", sender: "조회회원", json: { _id: id, chat_id: roomId, user_id: externalId } } });
    assert.equal((await send(`reconnect-${Date.now()}`, "/타이틀정보 1")).statusCode, 202);
    assert.match(replies.at(-1)!.data, /판매가: 🅟1,000,000/);
    await app.close();
  });
});
