import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };

describe("guild territory ready status MariaDB Iris integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "territory-ready-token";
  const roomId = "990000000000324";

  before(() => { database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 }); });
  after(async () => { try { await database.close(); } catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; } });

  it("queues one exact ready-status reply and leaves territory projections unchanged", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "territory-ready-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const counts = async () => (await database.query<Array<{ seasons: bigint; readySnapshots: bigint; readyEntries: bigint }>>(`SELECT (SELECT COUNT(*) FROM guild_territory_seasons) seasons, (SELECT COUNT(*) FROM guild_territory_ready_snapshots) readySnapshots, (SELECT COUNT(*) FROM guild_territory_ready_entries) readyEntries`))[0]!;
    const beforeCounts = await counts();
    const beforeOutbox = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM outbox_messages WHERE destination_id=?", [roomId]);
    const send = async (message: string, eventId: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화영지테스트방", sender: "영지준비테스터", json: { _id: eventId, chat_id: roomId, user_id: "territory-ready-user" } } });
    const eventId = `territory-ready-${Date.now()}`;
    assert.equal((await send("/길드영지준비확인", eventId)).statusCode, 202);
    assert.equal((await send("/길드영지준비확인", eventId)).statusCode, 202);
    const beforeSuffix = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM outbox_messages WHERE destination_id=?", [roomId]);
    assert.equal((await send("/길드영지준비확인 1", `territory-ready-suffix-${Date.now()}`)).statusCode, 202);
    const afterSuffix = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM outbox_messages WHERE destination_id=?", [roomId]);
    assert.equal(replies.length, 1);
    assert.match(replies[0]?.data ?? "", /📋 길드영지전 준비 현황/);
    assert.match(replies[0]?.data ?? "", /참여 준비 길드: 2개/);
    assert.match(replies[0]?.data ?? "", /합성 알파 길드/);
    assert.match(replies[0]?.data ?? "", /합성 보관 길드명/);
    assert.equal(beforeSuffix[0]?.count, (beforeOutbox[0]?.count ?? 0n) + 1n);
    assert.equal(afterSuffix[0]?.count, beforeSuffix[0]?.count);
    assert.deepEqual(await counts(), beforeCounts);
    await app.close();
  });
});
