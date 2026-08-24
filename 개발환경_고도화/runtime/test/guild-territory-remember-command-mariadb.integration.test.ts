import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };

describe("guild territory remember MariaDB Iris integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "territory-remember-token";
  const roomId = "990000000000338";

  before(() => { database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 }); });
  after(async () => { try { await database.close(); } catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; } });

  it("atomically persists ON/OFF preference, execution, audit and outbox with replay and suffix safety", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "territory-remember-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const count = async (table: string) => (await database.query<Array<{ count: bigint }>>(`SELECT COUNT(*) count FROM ${table}`))[0]!.count;
    const before = { operations: await count("operations"), executions: await count("command_executions"), audits: await count("command_audit"), outboxes: await count("outbox_messages") };
    const preferenceBefore = await database.query<Array<{ version: bigint }>>(
      `SELECT version FROM guild_territory_remember_preferences
       WHERE territory_scope_code='world-active' AND operator_player_id=900000001 AND player_id=900000001`
    );
    const send = async (message: string, eventId: string, userId = "synthetic-admin-alpha") => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화영지테스트방", sender: "테스트관리자알파", json: { _id: eventId, chat_id: roomId, user_id: userId } } });
    const onEvent = `territory-remember-on-${Date.now()}`;
    assert.equal((await send("/날기억해줘온", onEvent)).statusCode, 202);
    assert.equal((await send("/날기억해줘온", onEvent)).statusCode, 202);
    assert.equal((await send("/날기억해줘오프", `territory-remember-off-${Date.now()}`)).statusCode, 202);
    const beforeSuffix = await count("outbox_messages");
    assert.equal((await send("/날기억해줘온 1", `territory-remember-suffix-${Date.now()}`)).statusCode, 202);
    assert.equal(await count("outbox_messages"), beforeSuffix);
    const preference = await database.query<Array<{ desired_state: number; version: bigint }>>(
      `SELECT desired_state, version FROM guild_territory_remember_preferences
       WHERE territory_scope_code='world-active' AND operator_player_id=900000001 AND player_id=900000001`
    );
    assert.equal(Boolean(preference[0]?.desired_state), false);
    assert.equal(preference[0]?.version, (preferenceBefore[0]?.version ?? 0n) + 2n);
    assert.equal(await count("operations"), before.operations + 2n);
    assert.equal(await count("command_executions"), before.executions + 2n);
    assert.equal(await count("command_audit"), before.audits + 2n);
    assert.equal(await count("outbox_messages"), before.outboxes + 2n);
    assert.equal(replies.length, 2);
    assert.match(replies[0]?.data ?? "", /ON 상태/);
    assert.match(replies[1]?.data ?? "", /OFF 상태/);
  });

  it("audits a non-admin denial without changing preference", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "territory-remember-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const beforePreference = await database.query<Array<{ count: bigint }>>(
      "SELECT COUNT(*) count FROM guild_territory_remember_preferences WHERE operator_player_id=900000003"
    );
    const beforeAudit = await database.query<Array<{ count: bigint }>>(
      "SELECT COUNT(*) count FROM command_audit WHERE action_code='guild_territory_remember.set' AND result_code='forbidden'"
    );
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg: "/날기억해줘온", room: "고도화영지테스트방", sender: "테스트비관리자감마",
        json: { _id: `territory-remember-forbidden-${Date.now()}`, chat_id: roomId, user_id: "synthetic-non-admin-gamma" } }
    });
    assert.equal(response.statusCode, 202);
    assert.equal(replies.length, 1);
    assert.match(replies[0]?.data ?? "", /관리자만 변경/);
    const afterPreference = await database.query<Array<{ count: bigint }>>(
      "SELECT COUNT(*) count FROM guild_territory_remember_preferences WHERE operator_player_id=900000003"
    );
    const afterAudit = await database.query<Array<{ count: bigint }>>(
      "SELECT COUNT(*) count FROM command_audit WHERE action_code='guild_territory_remember.set' AND result_code='forbidden'"
    );
    assert.equal(afterPreference[0]?.count, beforePreference[0]?.count);
    assert.equal(afterAudit[0]?.count, (beforeAudit[0]?.count ?? 0n) + 1n);
  });

  it("rolls preference and command records back when outbox persistence fails", async () => {
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "territory-remember-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }) });
    const preferenceBefore = await database.query<Array<{ desired_state: number; version: bigint }>>(
      `SELECT desired_state, version FROM guild_territory_remember_preferences
       WHERE territory_scope_code='world-active' AND operator_player_id=900000001 AND player_id=900000001`
    );
    const commandCounts = async () => (await database.query<Array<{ operations: bigint; executions: bigint; audits: bigint }>>(
      `SELECT (SELECT COUNT(*) FROM operations) operations,
        (SELECT COUNT(*) FROM command_executions) executions,
        (SELECT COUNT(*) FROM command_audit) audits`
    ))[0]!;
    const before = await commandCounts();
    await database.execute("DROP TRIGGER IF EXISTS test_remember_outbox_failure");
    await database.execute(
      "CREATE TRIGGER test_remember_outbox_failure BEFORE INSERT ON outbox_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced remember outbox failure'"
    );
    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/integrations/iris/events?token=${token}`,
        payload: { msg: "/날기억해줘온", room: "고도화영지테스트방", sender: "테스트관리자알파",
          json: { _id: `territory-remember-rollback-${Date.now()}`, chat_id: roomId, user_id: "synthetic-admin-alpha" } }
      });
      assert.equal(response.statusCode, 500);
    } finally {
      await database.execute("DROP TRIGGER IF EXISTS test_remember_outbox_failure");
    }
    const preferenceAfter = await database.query<Array<{ desired_state: number; version: bigint }>>(
      `SELECT desired_state, version FROM guild_territory_remember_preferences
       WHERE territory_scope_code='world-active' AND operator_player_id=900000001 AND player_id=900000001`
    );
    assert.deepEqual(preferenceAfter, preferenceBefore);
    assert.deepEqual(await commandCounts(), before);
  });
});
