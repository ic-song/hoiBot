import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("player level reset MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "player-level-reset-token";
  const roomId = "990000000000227";
  const operatorExternalId = "level-reset-operator";
  const unauthorizedExternalId = "level-reset-user";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='PLAYER_LEVEL_RESET'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES ('level-reset-op','레벨 초기화 관리자','synthetic','active')");
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id='level-reset-op'"))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='super_admin'"))[0]!;
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    const fixtures: Array<[string, string, number, number, boolean]> = [[operatorExternalId,"레벨 초기화 관리자",4,6,true],[unauthorizedExternalId,"일반 회원",2,0,false],["level-user-a","회원A",10,0,false],["level-user-b","회원B",3,7,false],["level-user-c","회원C",1,5,false]];
    for (const [externalId, displayName, level, offset, isOperator] of fixtures) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,level,accumulated_level_offset,version) VALUES (?,?,?,?,1)", [player.id, displayName, level, offset]);
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, externalId, displayName]);
      if (isOperator) {
        const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [externalId]))[0]!;
        await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
      }
    }
    await database.execute("INSERT INTO players(status,version) VALUES ('suspended',1)");
    const suspended = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,level,accumulated_level_offset,version) VALUES (?,'정지 회원',99,99,1)", [suspended.id]);
  });

  after(async () => {
    if (!database) return;
    try { await database.close(); } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("resets active levels atomically, authorizes, replays, blocks suffixes, shadows and survives reconnect", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "player-level-reset-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const dependencies = { database, inspectIrisChannel: async () => ({ mode: "operational" as const, channelClass: "open_group" as const, reason: "allowed" as const, evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply: { room: string; data: string }) => { replies.push(reply); } };
    let app = buildApp(config, dependencies);
    const send = async (eventId: string, externalUserId: string, message: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화레벨초기화방", sender: "합성 관리자", json: { _id: eventId, chat_id: roomId, user_id: externalUserId } } });
    const totals = async () => (await database.query<Array<{ levels: string; offsets: string }>>("SELECT CAST(SUM(profile.level) AS CHAR) levels,CAST(SUM(profile.accumulated_level_offset) AS CHAR) offsets FROM player_profiles profile JOIN players player ON player.id=profile.player_id WHERE player.status='active'"))[0]!;
    const eventId = `level-reset-${Date.now()}`;
    assert.equal((await send(eventId, operatorExternalId, "/레벨리셋")).statusCode, 202);
    assert.equal(replies.at(-1)!.data, "리셋완.");
    assert.deepEqual(await totals(), { levels: "5", offsets: "38" });
    const suspended = (await database.query<Array<{ level: bigint; accumulated_level_offset: bigint }>>("SELECT profile.level,profile.accumulated_level_offset FROM player_profiles profile JOIN players player ON player.id=profile.player_id WHERE player.status='suspended'"))[0]!;
    assert.equal(suspended.level, 99n);
    assert.equal(suspended.accumulated_level_offset, 99n);
    await send(eventId, operatorExternalId, "/레벨리셋");
    assert.deepEqual(await totals(), { levels: "5", offsets: "38" });
    const beforeBlocked = replies.length;
    await send(`level-reset-suffix-${Date.now()}`, operatorExternalId, "/레벨리셋 1");
    await send(`level-reset-forbidden-${Date.now()}`, unauthorizedExternalId, "/레벨리셋");
    assert.equal(replies.length, beforeBlocked);
    assert.deepEqual(await totals(), { levels: "5", offsets: "38" });
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='PLAYER_LEVEL_RESET'");
    const shadowEvent = `level-reset-shadow-${Date.now()}`;
    await send(shadowEvent, operatorExternalId, "/레벨리셋");
    const route = (await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${shadowEvent}`]))[0]!;
    assert.equal(route.route, "SHADOW");
    assert.deepEqual(await totals(), { levels: "5", offsets: "38" });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='PLAYER_LEVEL_RESET'");
    await database.execute("UPDATE player_profiles profile JOIN players player ON player.id=profile.player_id SET profile.level=4,profile.version=profile.version+1 WHERE player.status='active'");
    await database.execute("CREATE TRIGGER synthetic_level_reset_failure BEFORE UPDATE ON player_profiles FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic level reset failure'");
    const failed = await send(`level-reset-failed-${Date.now()}`, operatorExternalId, "/레벨리셋");
    assert.equal(failed.statusCode, 500);
    await database.execute("DROP TRIGGER synthetic_level_reset_failure");
    assert.deepEqual(await totals(), { levels: "20", offsets: "38" });
    assert.equal((await send(`level-reset-retry-${Date.now()}`, operatorExternalId, "/레벨리셋")).statusCode, 202);
    assert.deepEqual(await totals(), { levels: "5", offsets: "58" });
    await database.execute("UPDATE player_profiles profile JOIN players player ON player.id=profile.player_id SET profile.level=2,profile.version=profile.version+1 WHERE player.status='active'");
    await app.close();
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    app = buildApp(config, { ...dependencies, database });
    assert.equal((await send(`level-reset-reconnect-${Date.now()}`, operatorExternalId, "/레벨리셋")).statusCode, 202);
    assert.deepEqual(await totals(), { levels: "5", offsets: "68" });
    await app.close();
  });
});
