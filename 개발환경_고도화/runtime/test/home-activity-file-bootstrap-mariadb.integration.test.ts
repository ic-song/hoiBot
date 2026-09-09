import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("home activity file bootstrap MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "home-activity-bootstrap-token";
  const roomId = "990000000000585";
  const suffix = Date.now().toString();
  const operatorExternalId = `activity-bootstrap-operator-${suffix}`;
  const unauthorizedExternalId = `activity-bootstrap-user-${suffix}`;
  let operatorPlayerId = 0n;
  let unauthorizedPlayerId = 0n;
  const connect = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });

  before(async () => {
    database = connect();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='HOME_ACTIVITY_FILE_BOOTSTRAP'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,'synthetic','active')", [`activity-bootstrap-op-${suffix}`, "합성 활동 운영자"]);
    await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES (?,?,1)", [`activity-bootstrap-role-${suffix}`, "합성 활동 역할"]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`activity-bootstrap-op-${suffix}`]))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code=?", [`activity-bootstrap-role-${suffix}`]))[0]!;
    await database.execute("INSERT INTO admin_role_permissions(role_id,permission_code) VALUES (?,'game.home.moderate')", [role.id]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    for (const [externalId, displayName] of [[operatorExternalId, "합성 활동 운영자"], [unauthorizedExternalId, "합성 일반 사용자"]] as const) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      if (externalId === operatorExternalId) operatorPlayerId = player.id; else unauthorizedPlayerId = player.id;
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, externalId, displayName]);
    }
    const operatorIdentity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [operatorExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, operatorIdentity.id]);
    process.env.HOME_ACTIVITY_FILE_BOOTSTRAP_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
  });

  after(async () => {
    delete process.env.HOME_ACTIVITY_FILE_BOOTSTRAP_COMMAND_ENABLED;
    delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
    if (!database) return;
    try { await database.execute("DROP TRIGGER IF EXISTS fail_home_activity_bootstrap_audit"); await database.close(); }
    catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; }
  });

  it("authorizes, rolls back, creates once, preserves existing rows, replays, shadows and reconnects", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "home-activity-bootstrap-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    let app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = (eventId: string, externalUserId: string, message = "/펫홈활동파일생성") => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화펫테스트방", sender: "합성 운영자", json: { _id: eventId, chat_id: roomId, user_id: externalUserId } } });
    const scalar = async (sql: string, params: unknown[] = []) => (await database.query<Array<{ value: bigint }>>(sql, params))[0]!.value;

    assert.equal((await send(`activity-bootstrap-forbidden-${suffix}`, unauthorizedExternalId)).statusCode, 403);
    await database.execute("CREATE TRIGGER fail_home_activity_bootstrap_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic activity bootstrap audit failure'");
    assert.equal((await send(`activity-bootstrap-rollback-${suffix}`, operatorExternalId)).statusCode, 500);
    await database.execute("DROP TRIGGER fail_home_activity_bootstrap_audit");
    assert.equal(await scalar("SELECT COUNT(*) value FROM pet_home_activity_bootstrap_state"), 0n);
    assert.equal(await scalar("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='home.activity.bootstrap'"), 0n);

    const createEvent = `activity-bootstrap-create-${suffix}`;
    assert.equal((await send(createEvent, operatorExternalId)).statusCode, 202);
    assert.match(replies.at(-1)!.data, /활동 파일 생성 완료/);
    await send(createEvent, operatorExternalId);
    assert.equal(await scalar("SELECT COUNT(*) value FROM pet_home_activity_bootstrap_runs"), 1n);
    await database.execute("INSERT INTO pet_home_follows(follower_player_id,followed_player_id) VALUES (?,?)", [operatorPlayerId, unauthorizedPlayerId]);
    assert.equal((await send(`activity-bootstrap-existing-${suffix}`, operatorExternalId)).statusCode, 202);
    assert.match(replies.at(-1)!.data, /이미 있습니다/);
    assert.equal(await scalar("SELECT COUNT(*) value FROM pet_home_follows"), 1n);
    await database.execute("DELETE FROM pet_home_activity_bootstrap_state WHERE resource_code='PET_HOME_ACTIVITY'");
    assert.equal((await send(`activity-bootstrap-discovered-${suffix}`, operatorExternalId)).statusCode, 202);
    assert.match(replies.at(-1)!.data, /이미 있습니다/);
    assert.equal(Number(await scalar("SELECT discovered_existing value FROM pet_home_activity_bootstrap_state WHERE resource_code='PET_HOME_ACTIVITY'")), 1);
    assert.equal(await scalar("SELECT COUNT(*) value FROM pet_home_follows"), 1n);

    const replyCount = replies.length;
    await send(`activity-bootstrap-suffix-${suffix}`, operatorExternalId, "/펫홈활동파일생성 1");
    assert.equal(replies.length, replyCount);
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='HOME_ACTIVITY_FILE_BOOTSTRAP'");
    await send(`activity-bootstrap-shadow-${suffix}`, operatorExternalId);
    assert.equal(await scalar("SELECT COUNT(*) value FROM pet_home_activity_bootstrap_runs"), 3n);
    const beforeRestart = [await scalar("SELECT COUNT(*) value FROM pet_home_activity_bootstrap_state"), await scalar("SELECT COUNT(*) value FROM pet_home_activity_bootstrap_runs"), await scalar("SELECT COUNT(*) value FROM pet_home_follows")].map(String).join("/");
    await app.close();
    database = connect();
    const afterRestart = [await scalar("SELECT COUNT(*) value FROM pet_home_activity_bootstrap_state"), await scalar("SELECT COUNT(*) value FROM pet_home_activity_bootstrap_runs"), await scalar("SELECT COUNT(*) value FROM pet_home_follows")].map(String).join("/");
    assert.equal(afterRestart, beforeRestart);
    app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }) });
    await app.close();
  });
});
