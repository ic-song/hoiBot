import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { DebugModeService } from "../src/admin/debug-mode-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("admin debug mode MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  let operatorExternalId: string;
  let unauthorizedExternalId: string;
  const token = "debug-mode-token";
  const roomId = "990000000000575";

  before(async () => {
    const suffix = Date.now().toString();
    operatorExternalId = `debug-mode-operator-${suffix}`;
    unauthorizedExternalId = `debug-mode-user-${suffix}`;
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='ADMIN_DEBUG_MODE'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,'synthetic','active')", [`debug-mode-${suffix}`, "합성 디버깅 관리자"]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`debug-mode-${suffix}`]))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='super_admin'"))[0]!;
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    for (const [externalId, name] of [[operatorExternalId, "합성 디버깅 관리자"], [unauthorizedExternalId, "합성 일반 사용자"]]) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const playerId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!.id;
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [playerId, name]);
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [playerId, externalId, name]);
      if (externalId === operatorExternalId) {
        const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [externalId]))[0]!;
        await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
      }
    }
    process.env.DEBUG_MODE_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
  });

  after(async () => {
    delete process.env.DEBUG_MODE_COMMAND_ENABLED;
    if (!database) return;
    try { await database.close(); } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("toggles once, replays, resets by process, blocks unauthorized/Shadow and rolls back outbox failure", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "debug-mode-pepper",
      DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
      DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (eventId: string, userId: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg: "/디버깅모드", room: "고도화디버깅방", sender: "합성 관리자", json: { _id: eventId, chat_id: roomId, user_id: userId } } });

    const onEvent = `debug-on-${Date.now()}`;
    assert.equal((await send(onEvent, operatorExternalId)).statusCode, 202);
    assert.equal(replies.at(-1)?.data, "디버깅 모드 : ON");
    const processId = (await database.query<Array<{ process_instance_id: string }>>("SELECT process_instance_id FROM admin_debug_mode_instances ORDER BY updated_at DESC LIMIT 1"))[0]!.process_instance_id;
    const current = new DebugModeService(database, processId);
    assert.equal(await current.isEnabled(), true);
    const replay = await current.execute({ eventId: `iris:${onEvent}`, externalUserId: operatorExternalId, destinationId: roomId });
    assert.equal(replay.replayed, true);
    assert.equal(replay.enabled, true);
    assert.equal(await new DebugModeService(database, randomUUID()).isEnabled(), false);

    const offEvent = `debug-off-${Date.now()}`;
    assert.equal((await send(offEvent, operatorExternalId)).statusCode, 202);
    assert.equal(replies.at(-1)?.data, "디버깅 모드 : OFF");
    assert.equal(await current.isEnabled(), false);
    const evidence = (await database.query<Array<{ mutations: bigint; audits: bigint; outbox: bigint }>>(
      `SELECT (SELECT COUNT(*) FROM admin_debug_mode_mutations WHERE process_instance_id=?) AS mutations,
              (SELECT COUNT(*) FROM command_audit WHERE action_code='ADMIN_DEBUG_MODE') AS audits,
              (SELECT COUNT(*) FROM outbox_messages outbox JOIN admin_debug_mode_mutations mutation ON mutation.operation_id=outbox.operation_id WHERE mutation.process_instance_id=?) AS outbox`,
      [processId, processId]))[0]!;
    assert.deepEqual(evidence, { mutations: 2n, audits: 2n, outbox: 2n });

    const forbidden = await send(`debug-forbidden-${Date.now()}`, unauthorizedExternalId);
    assert.equal(forbidden.statusCode, 403, forbidden.body);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='ADMIN_DEBUG_MODE'");
    const shadowEvent = `debug-shadow-${Date.now()}`;
    assert.equal((await send(shadowEvent, operatorExternalId)).statusCode, 202);
    assert.equal(await current.isEnabled(), false);
    assert.equal((await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${shadowEvent}`]))[0]!.route, "SHADOW");

    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='ADMIN_DEBUG_MODE'");
    await database.execute("CREATE TRIGGER synthetic_debug_mode_outbox_failure BEFORE INSERT ON outbox_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic debug outbox failure'");
    const rollbackEvent = `debug-rollback-${Date.now()}`;
    try {
      assert.equal((await send(rollbackEvent, operatorExternalId)).statusCode, 500);
    } finally {
      await database.execute("DROP TRIGGER IF EXISTS synthetic_debug_mode_outbox_failure");
    }
    assert.equal(await current.isEnabled(), false);
    assert.equal(Number((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM admin_debug_mode_mutations WHERE request_key=?", [`iris:${rollbackEvent}`]))[0]!.count), 0);
    await app.close();
  });
});
