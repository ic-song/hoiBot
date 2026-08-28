import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("home feed mutate SHADOW", { skip: !enabled }, () => {
  let db: DatabaseClient;
  const suffix = Date.now().toString();
  const external = `feed-shadow-${suffix}`;
  const token = "home-feed-shadow-token";
  const room = "990000000000624";
  before(async () => {
    db = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 3, connectTimeoutMs: 5000 });
    const player = await db.execute("INSERT INTO players(status,version) VALUES('active',1)");
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES(?,'피드 SHADOW',1)", [player.insertId]);
    await db.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES(?,'kakao',?,'피드 SHADOW','linked')", [player.insertId, external]);
    await db.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE handler_key='home_feed_mutate'");
  });
  after(async () => { if (db) try { await db.close(); } catch {} });
  it("does not mutate", async () => {
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "home-feed-shadow-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    process.env.HOME_FEED_MUTATE_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    const app = buildApp(config, { database: db, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async () => {} });
    const eventId = `feed-shadow-event-${suffix}`;
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: "/피드 테스트", room: "고도화펫테스트방", sender: "피드 SHADOW", json: { _id: eventId, chat_id: room, user_id: external } } });
    assert.equal((await db.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM operations WHERE idempotency_scope='home.feed.mutate' AND idempotency_key=?", [eventId]))[0]!.count, 0n);
    delete process.env.HOME_FEED_MUTATE_COMMAND_ENABLED;
    await app.close();
  });
});
