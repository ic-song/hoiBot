import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("privileged point rank MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "point-rank-token", operatorUserId = "point-rank-super-admin";
  const open = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"),
    password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });

  before(async () => {
    database = open();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='PRIVILEGED_POINT_RANK_READ'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES('point-rank-op','포인트 관리자','x','active')");
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id='point-rank-op'"))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='super_admin'"))[0]!;
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES(?,?)", [operator.id, role.id]);
    for (const [externalId, name, rankEmoji, point] of [[operatorUserId, "관리자", "🌟", "123456789"], ["point-rank-2", "둘", "🌱", "500"], ["point-rank-3", "셋", "🥉", null]] as const) {
      await database.execute("INSERT INTO players(status,version) VALUES('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES(?,?,1)", [player.id, name]);
      await database.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES(?,?,?)", [player.id, rankEmoji, player.id]);
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES(?,'kakao',?,?,'linked')", [player.id, externalId, name]);
      if (point !== null) await database.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES(?,'point',?,1)", [player.id, point]);
      if (externalId === operatorUserId) {
        const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [externalId]))[0]!;
        await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES(?,?)", [operator.id, identity.id]);
      }
    }
  });

  after(async () => { if (database) try { await database.close(); } catch {} });

  it("ranks zero-inclusive balances, replays, rolls back, shadows and reconnects", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "point-rank-pepper", DATABASE_ENABLED: "true",
      DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const dependencies = { database, inspectIrisChannel: async () => ({ mode: "operational" as const, channelClass: "open_group" as const, reason: "allowed" as const,
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply: { room: string; data: string }) => { replies.push(reply); } };
    let app = buildApp(config, dependencies);
    let send = (eventId: string, message: string, userId = operatorUserId) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg: message, room: "고도화포인트순위방", sender: "포인트 관리자", json: { _id: eventId, chat_id: "990000000000415", user_id: userId } } });

    const eventId = `point-rank-${Date.now()}`;
    assert.equal((await send(eventId, "/포인트확인")).statusCode, 202);
    assert.match(replies.at(-1)!.data, /🥇\. \[🌟관리자\] 🅟123,456,789[\s\S]*🥈\. \[🌱둘\] 🅟500[\s\S]*🥉\. \[🥉셋\] 🅟0/);
    await send(eventId, "/포인트확인");
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM command_executions WHERE command_code='PRIVILEGED_POINT_RANK_READ'"))[0]!.count_value), 1);
    const beforeUnauthorized = replies.length;
    await send(`unauthorized-${Date.now()}`, "/포인트확인", "point-rank-2");
    assert.equal(replies.length, beforeUnauthorized);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='PRIVILEGED_POINT_RANK_READ'");
    const beforeShadow = replies.length;
    await send(`shadow-${Date.now()}`, "/포인트확인");
    assert.equal(replies.length, beforeShadow);
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='PRIVILEGED_POINT_RANK_READ'");

    await database.execute("CREATE TRIGGER synthetic_point_rank_audit_failure BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fail'");
    assert.equal((await send(`fail-${Date.now()}`, "/포인트확인")).statusCode, 500);
    await database.execute("DROP TRIGGER synthetic_point_rank_audit_failure");
    assert.equal(await database.verifyRollback(), true);

    await app.close();
    database = open();
    app = buildApp(config, { ...dependencies, database });
    send = (nextEventId, message, userId = operatorUserId) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg: message, room: "고도화포인트순위방", sender: "포인트 관리자", json: { _id: nextEventId, chat_id: "990000000000415", user_id: userId } } });
    assert.equal((await send(`reconnect-${Date.now()}`, "/포인트확인")).statusCode, 202);
    await app.close();
  });
});
