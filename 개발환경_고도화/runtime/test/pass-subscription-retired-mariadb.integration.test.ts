import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { parsePassSubscriptionRetiredCommand, PassSubscriptionRetiredCommandService } from "../src/pass/pass-subscription-retired-command-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true", required = (name: string) => process.env[name] ?? "integration-not-configured";
describe("retired pass subscription MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "retired-pass-token", room = "990000000000585", suffix = Date.now().toString(), userId = `retired-pass-user-${suffix}`;
  const open = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
  before(async () => {
    database = open();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='PASS_SUBSCRIPTION_RETIRED'");
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'구독 테스트',1)", [player.id]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'구독 테스트','linked')", [player.id, userId]);
  });
  after(async () => {
    if (!database) return;
    try { await database.execute("DROP TRIGGER IF EXISTS fail_retired_pass_outbox"); await database.close(); }
    catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; }
  });
  it("replies, replays, shadows, rolls back, and reconnects without domain mutation", async () => {
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "retired-pass-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    process.env.PASS_SUBSCRIPTION_RETIRED_COMMAND_ENABLED = "true"; process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async () => {} });
    const payload = { msg: "/공헌패스구독", room: "고도화펫테스트방", sender: "구독 테스트", json: { _id: `retired-pass-active-${suffix}`, chat_id: room, user_id: userId } };
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload });
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload });
    const beforeShadow = (await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM outbox_messages"))[0]!.count;
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='PASS_SUBSCRIPTION_RETIRED'");
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: "/다이아패스구독 안내", room: "고도화펫테스트방", sender: "구독 테스트", json: { _id: `retired-pass-shadow-${suffix}`, chat_id: room, user_id: userId } } });
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM outbox_messages"))[0]!.count, beforeShadow);
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='PASS_SUBSCRIPTION_RETIRED'");
    const rollbackId = `retired-pass-rollback-${suffix}`;
    await database.execute("INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?,'iris',?,'message','test','incoming',REPEAT('e',64),'parsed','processing',UTC_TIMESTAMP(3))", [rollbackId, rollbackId]);
    await database.execute("CREATE TRIGGER fail_retired_pass_outbox BEFORE INSERT ON outbox_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic retired pass outbox failure'");
    const service = new PassSubscriptionRetiredCommandService(database), command = parsePassSubscriptionRetiredCommand("/다이아패스구독")!;
    await assert.rejects(() => service.reply({ command, eventId: rollbackId, destinationId: room, actorId: userId }), /synthetic retired pass outbox failure/);
    await database.execute("DROP TRIGGER fail_retired_pass_outbox");
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM operations WHERE idempotency_scope='pass_subscription_retired' AND idempotency_key=?", [rollbackId]))[0]!.count, 0n);
    await app.close(); database = open();
    const activeId = `iris:${String(payload.json._id)}`;
    const replay = await new PassSubscriptionRetiredCommandService(database).reply({ command: parsePassSubscriptionRetiredCommand("/공헌패스구독")!, eventId: activeId, destinationId: room, actorId: userId });
    assert.equal(replay.replayed, true);
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM player_support_passes WHERE pass_code IN ('contribution','diamond')"))[0]!.count, 0n);
    delete process.env.PASS_SUBSCRIPTION_RETIRED_COMMAND_ENABLED;
  });
});
