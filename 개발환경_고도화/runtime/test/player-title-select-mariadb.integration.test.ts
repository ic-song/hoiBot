import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string) => process.env[name] ?? "integration-not-configured";

describe("player title select MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "player-title-select-token";
  const roomId = "990000000000233";
  const externalId = "title-select-requester";
  const open = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5000 });

  before(async () => {
    database = open();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='PLAYER_TITLE_SELECT'");
    await database.execute("INSERT INTO players(status,version) VALUES('active',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES(?,'타이틀회원',1)", [player.id]);
    await database.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES(?,'⭐',1)", [player.id]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES(?,'kakao',?,'타이틀회원','linked')", [player.id, externalId]);
    await database.execute("INSERT INTO title_definitions(code,display_name,scope_code,active) VALUES('title_select_first','첫 번째','player',TRUE),('title_select_second','두 번째','player',TRUE)");
    const titles = await database.query<Array<{ id: bigint; code: string }>>("SELECT id,code FROM title_definitions WHERE code IN('title_select_first','title_select_second') ORDER BY code");
    const first = titles.find((title) => title.code === "title_select_first")!;
    const second = titles.find((title) => title.code === "title_select_second")!;
    await database.execute("INSERT INTO player_titles(player_id,title_id,acquired_at,equipped,display_order) VALUES(?,?,UTC_TIMESTAMP(3),TRUE,1),(?,?,UTC_TIMESTAMP(3),FALSE,2)", [player.id, first.id, player.id, second.id]);
  });

  after(async () => {
    if (database) try { await database.close(); } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ER_POOL_ALREADY_CLOSED")) throw error;
    }
  });

  it("selects by fixed order, replays, rolls back, shadows and reconnects", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "player-title-select-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const dependencies = { database, inspectIrisChannel: async () => ({ mode: "operational" as const, channelClass: "open_group" as const, reason: "allowed" as const, evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply: { room: string; data: string }) => { replies.push(reply); } };
    let app = buildApp(config, dependencies);
    let send = (id: string, message: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화팻테스트방", sender: "타이틀회원", json: { _id: id, chat_id: roomId, user_id: externalId } } });

    const eventId = `title-select-${Date.now()}`;
    assert.equal((await send(eventId, "/타이틀 2")).statusCode, 202);
    assert.equal(replies.at(-1)!.data, "[⭐타이틀회원] 님의 타이틀이\n[두 번째] (으)로 적용되었습니다.");
    let equipped = await database.query<Array<{ display_name: string }>>("SELECT definition.display_name FROM player_titles owned JOIN title_definitions definition ON definition.id=owned.title_id JOIN external_identities identity ON identity.player_id=owned.player_id WHERE identity.external_user_id=? AND owned.equipped=TRUE", [externalId]);
    assert.deepEqual(equipped, [{ display_name: "두 번째" }]);

    await send(eventId, "/타이틀 2");
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM command_executions WHERE command_code='PLAYER_TITLE_SELECT'"))[0]!.count_value), 1);

    const beforeShadow = replies.length;
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='PLAYER_TITLE_SELECT'");
    await send(`shadow-${Date.now()}`, "/타이틀 1");
    assert.equal(replies.length, beforeShadow);
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='PLAYER_TITLE_SELECT'");

    await database.execute("CREATE TRIGGER synthetic_title_select_audit_failure BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic audit failure'");
    assert.equal((await send(`failed-${Date.now()}`, "/타이틀 1")).statusCode, 500);
    await database.execute("DROP TRIGGER synthetic_title_select_audit_failure");
    equipped = await database.query<Array<{ display_name: string }>>("SELECT definition.display_name FROM player_titles owned JOIN title_definitions definition ON definition.id=owned.title_id JOIN external_identities identity ON identity.player_id=owned.player_id WHERE identity.external_user_id=? AND owned.equipped=TRUE", [externalId]);
    assert.deepEqual(equipped, [{ display_name: "두 번째" }]);

    await app.close();
    database = open();
    app = buildApp(config, { ...dependencies, database });
    send = (id, message) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화팻테스트방", sender: "타이틀회원", json: { _id: id, chat_id: roomId, user_id: externalId } } });
    assert.equal((await send(`reconnect-${Date.now()}`, "/타이틀 1")).statusCode, 202);
    assert.match(replies.at(-1)!.data, /\[첫 번째\]/);
    await app.close();
  });
});
