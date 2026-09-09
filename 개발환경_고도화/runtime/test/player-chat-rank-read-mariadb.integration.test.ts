import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string) => process.env[name] ?? "integration-not-configured";

describe("player chat rank read MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "player-chat-rank-token";
  const roomId = "990000000000232";
  const externalId = "chat-rank-requester";
  const open = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5000 });
  before(async () => {
    database = open();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='PLAYER_CHAT_RANK_READ'");
    await database.execute("UPDATE player_chat_rank_settings SET source_checkcnt='20260801',history_since_display='2026년 8월 1일' WHERE singleton_key=1");
    for (let index = 0; index < 12; index++) {
      await database.execute("INSERT INTO players(status,version) VALUES('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES(?,?,1)", [player.id, `채팅회원${index + 1}`]);
      await database.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES(?,?,?)", [player.id, index === 0 ? "⭐" : "", index + 1]);
      await database.execute("INSERT INTO player_counters(player_id,counter_code,period_key,value) VALUES(?,'chatcnt0','current',?)", [player.id, index < 2 ? 9007199254740993n : 1000 - index]);
      if (index === 0) await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES(?,'kakao',?,'채팅회원1','linked')", [player.id, externalId]);
    }
  });
  after(async () => { if (database) try { await database.close(); } catch (error) { if (!(typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ER_POOL_ALREADY_CLOSED")) throw error; } });
  it("ranks, snapshots, replays, rolls back, shadows and reconnects", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "player-chat-rank-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const dependencies = { database, inspectIrisChannel: async () => ({ mode: "operational" as const, channelClass: "open_group" as const, reason: "allowed" as const, evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply: { room: string; data: string }) => { replies.push(reply); } };
    let app = buildApp(config, dependencies);
    let send = (id: string, message: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화채팅순위방", sender: "채팅회원1", json: { _id: id, chat_id: roomId, user_id: externalId } } });
    const eventId = `chat-rank-${Date.now()}`;
    const first = await send(eventId, "/채팅순위");
    assert.equal(first.statusCode, 202, first.body);
    assert.match(replies.at(-1)!.data, /\[2026년 8월 1일 이후 채팅 이력 기준\]/);
    assert.match(replies.at(-1)!.data, /🥇\. ⭐채팅회원1 - 채팅수: 9,007,199,254,740,993/);
    assert.equal((replies.at(-1)!.data.match(/\u200b/g) ?? []).length, 500);
    let snapshot = (await database.query<Array<{ name: string; top_chat_count: bigint }>>("SELECT profile.current_display_name name,snapshot.top_chat_count FROM player_chat_rank_snapshots snapshot JOIN player_profiles profile ON profile.player_id=snapshot.top_player_id"))[0]!;
    assert.deepEqual(snapshot, { name: "채팅회원1", top_chat_count: 9007199254740993n });
    await send(eventId, "/채팅순위");
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM command_executions WHERE command_code='PLAYER_CHAT_RANK_READ'"))[0]!.count_value), 1);
    const beforeShadow = replies.length;
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='PLAYER_CHAT_RANK_READ'");
    await send(`shadow-${Date.now()}`, "/채팅순위");
    assert.equal(replies.length, beforeShadow);
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='PLAYER_CHAT_RANK_READ'");
    await database.execute("UPDATE player_counters counter JOIN player_profiles profile ON profile.player_id=counter.player_id SET counter.value=9007199254740994 WHERE profile.current_display_name='채팅회원2' AND counter.counter_code='chatcnt0' AND counter.period_key='current'");
    await database.execute("CREATE TRIGGER synthetic_chat_rank_audit_failure BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic audit failure'");
    assert.equal((await send(`failed-${Date.now()}`, "/채팅순위")).statusCode, 500);
    await database.execute("DROP TRIGGER synthetic_chat_rank_audit_failure");
    snapshot = (await database.query<Array<{ name: string; top_chat_count: bigint }>>("SELECT profile.current_display_name name,snapshot.top_chat_count FROM player_chat_rank_snapshots snapshot JOIN player_profiles profile ON profile.player_id=snapshot.top_player_id"))[0]!;
    assert.equal(snapshot.name, "채팅회원1");
    await app.close();
    database = open();
    app = buildApp(config, { ...dependencies, database });
    send = (id, message) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화채팅순위방", sender: "채팅회원1", json: { _id: id, chat_id: roomId, user_id: externalId } } });
    assert.equal((await send(`reconnect-${Date.now()}`, "/채팅순위")).statusCode, 202);
    snapshot = (await database.query<Array<{ name: string; top_chat_count: bigint }>>("SELECT profile.current_display_name name,snapshot.top_chat_count FROM player_chat_rank_snapshots snapshot JOIN player_profiles profile ON profile.player_id=snapshot.top_player_id"))[0]!;
    assert.deepEqual(snapshot, { name: "채팅회원2", top_chat_count: 9007199254740994n });
    await app.close();
  });
});
