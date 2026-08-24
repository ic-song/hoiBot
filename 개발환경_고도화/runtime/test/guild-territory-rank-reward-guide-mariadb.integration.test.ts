import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

describe("guild territory rank reward guide MariaDB Iris integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "territory-reward-guide-token";
  const roomId = "990000000000331";
  const userId = "territory-reward-guide-user";

  before(() => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
  });

  after(async () => {
    try { await database.close(); } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("replies identically for both aliases without changing territory projections", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "territory-guide-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, {
      database,
      inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }),
      sendIrisTextReply: async (reply) => { replies.push(reply); },
    });
    const counts = async () => (await database.query<Array<{ seasons: bigint; snapshots: bigint; rankings: bigint; rules: bigint; tiers: bigint }>>(
      `SELECT (SELECT COUNT(*) FROM guild_territory_seasons) AS seasons,
       (SELECT COUNT(*) FROM guild_territory_ranking_snapshots) AS snapshots,
       (SELECT COUNT(*) FROM guild_territory_ranking_entries) AS rankings,
       (SELECT COUNT(*) FROM guild_territory_reward_rule_versions) AS rules,
       (SELECT COUNT(*) FROM guild_territory_reward_rule_tiers) AS tiers`,
    ))[0]!;
    const beforeCounts = await counts();
    const send = async (message: string, eventId: string) => app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg: message, room: "고도화영지테스트방", sender: "영지조회테스터", json: { _id: eventId, chat_id: roomId, user_id: userId } },
    });
    const firstEvent = `territory-guide-first-${Date.now()}`;
    assert.equal((await send("/영지순위보상", firstEvent)).statusCode, 202);
    assert.equal((await send("/영지순위보상", firstEvent)).statusCode, 202);
    assert.equal((await send("/영지보상순위", `territory-guide-alias-${Date.now()}`)).statusCode, 202);
    const outboxBeforeSuffix = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM outbox_messages WHERE destination_id=?", [roomId]);
    assert.equal((await send("/영지순위보상 안내", `territory-guide-suffix-${Date.now()}`)).statusCode, 202);
    const outboxAfterSuffix = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM outbox_messages WHERE destination_id=?", [roomId]);
    assert.equal(replies.length, 2);
    assert.equal(replies[0]?.data, replies[1]?.data);
    assert.match(replies[0]?.data ?? "", /1위   🅟500,000,000/);
    assert.match(replies[0]?.data ?? "", /6위~10위   🅟50,000,000/);
    assert.equal(outboxBeforeSuffix[0]?.count, 2n);
    assert.equal(outboxAfterSuffix[0]?.count, 2n);
    assert.deepEqual(await counts(), beforeCounts);
    await app.close();
  });
});
