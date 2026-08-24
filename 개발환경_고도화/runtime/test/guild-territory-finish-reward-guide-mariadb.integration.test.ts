import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };

describe("guild territory finish reward guide MariaDB Iris integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "territory-finish-guide-token";
  const roomId = "990000000000332";

  before(() => { database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 }); });
  after(async () => { try { await database.close(); } catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; } });

  it("queues both exact aliases once and leaves reward and payout state unchanged", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "territory-finish-guide-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const counts = async () => (await database.query<Array<{ versions: bigint; tiers: bigint; operations: bigint; audits: bigint }>>(`SELECT (SELECT COUNT(*) FROM guild_territory_reward_rule_versions) versions, (SELECT COUNT(*) FROM guild_territory_reward_rule_tiers) tiers, (SELECT COUNT(*) FROM operations) operations, (SELECT COUNT(*) FROM command_audit) audits`))[0]!;
    const beforeCounts = await counts();
    const beforeOutbox = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM outbox_messages WHERE destination_id=?", [roomId]);
    const send = async (message: string, eventId: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화영지테스트방", sender: "종료보상테스터", json: { _id: eventId, chat_id: roomId, user_id: "territory-finish-guide-user" } } });
    const eventId = `territory-finish-guide-${Date.now()}`;
    assert.equal((await send("/영지종료보상", eventId)).statusCode, 202);
    assert.equal((await send("/영지종료보상", eventId)).statusCode, 202);
    assert.equal((await send("영지종료보상", `territory-finish-guide-plain-${Date.now()}`)).statusCode, 202);
    const beforeSuffix = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM outbox_messages WHERE destination_id=?", [roomId]);
    assert.equal((await send("/영지종료보상 1", `territory-finish-guide-suffix-${Date.now()}`)).statusCode, 202);
    const afterSuffix = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM outbox_messages WHERE destination_id=?", [roomId]);
    assert.equal(replies.length, 2);
    assert.match(replies[0]?.data ?? "", /호월킹덤 세금 15%/);
    assert.match(replies[0]?.data ?? "", /길드창고 포인트와 영지점수$/);
    assert.equal(replies[1]?.data, replies[0]?.data);
    assert.equal(beforeSuffix[0]?.count, (beforeOutbox[0]?.count ?? 0n) + 2n);
    assert.equal(afterSuffix[0]?.count, beforeSuffix[0]?.count);
    const afterCounts = await counts();
    assert.equal(afterCounts.versions, beforeCounts.versions);
    assert.equal(afterCounts.tiers, beforeCounts.tiers);
    assert.equal(afterCounts.audits, beforeCounts.audits);
    assert.equal(afterCounts.operations, beforeCounts.operations + 2n);
    await app.close();
  });
});
