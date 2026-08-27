import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("home comment file bootstrap MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "home-comment-bootstrap-token";
  const roomId = "990000000000578";
  const suffix = Date.now().toString();
  const operatorExternalId = `comment-bootstrap-operator-${suffix}`;
  const unauthorizedExternalId = `comment-bootstrap-user-${suffix}`;

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='HOME_COMMENT_FILE_BOOTSTRAP'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,'synthetic','active')", [`comment-bootstrap-op-${suffix}`, "합성 펫홈 운영자"]);
    await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES (?,? ,1)", [`comment-bootstrap-role-${suffix}`, "합성 펫홈 역할"]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`comment-bootstrap-op-${suffix}`]))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code=?", [`comment-bootstrap-role-${suffix}`]))[0]!;
    await database.execute("INSERT INTO admin_role_permissions(role_id,permission_code) VALUES (?,'game.home.moderate')", [role.id]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    for (const identity of [[operatorExternalId, "합성 펫홈 운영자"], [unauthorizedExternalId, "합성 일반 사용자"]] as const) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, identity[0], identity[1]]);
    }
    const operatorIdentity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [operatorExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, operatorIdentity.id]);
  });

  after(async () => {
    if (!database) return;
    try {
      await database.execute("DROP TRIGGER IF EXISTS fail_home_comment_bootstrap_audit");
      await database.close();
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("authorizes, rolls back, creates once, replays, reports existing and shadows without mutation", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "home-comment-bootstrap-pepper",
      DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"),
      DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    process.env.HOME_COMMENT_FILE_BOOTSTRAP_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (eventId: string, externalUserId: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg: "/펫홈댓글파일생성", room: "고도화펫테스트방", sender: "합성 운영자", json: { _id: eventId, chat_id: roomId, user_id: externalUserId } } });

    const unauthorized = await send(`comment-bootstrap-forbidden-${suffix}`, unauthorizedExternalId);
    assert.equal(unauthorized.statusCode, 403);
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM home_comment_bootstrap_state"))[0]!.count_value), 0);

    await database.execute("CREATE TRIGGER fail_home_comment_bootstrap_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic comment bootstrap audit failure'");
    const rollbackEvent = `comment-bootstrap-rollback-${suffix}`;
    assert.equal((await send(rollbackEvent, operatorExternalId)).statusCode, 500);
    await database.execute("DROP TRIGGER fail_home_comment_bootstrap_audit");
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM home_comment_bootstrap_state"))[0]!.count_value), 0);
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM operations WHERE idempotency_scope='home.comment.bootstrap'"))[0]!.count_value), 0);

    const createEvent = `comment-bootstrap-create-${suffix}`;
    const created = await send(createEvent, operatorExternalId);
    assert.equal(created.statusCode, 202, created.body);
    assert.match(replies.at(-1)!.data, /댓글 파일 생성 완료/);
    await send(createEvent, operatorExternalId);
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM home_comment_bootstrap_runs"))[0]!.count_value), 1);

    assert.equal((await send(`comment-bootstrap-existing-${suffix}`, operatorExternalId)).statusCode, 202);
    assert.match(replies.at(-1)!.data, /이미 있습니다/);
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM home_comment_bootstrap_state"))[0]!.count_value), 1);
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM home_comment_bootstrap_runs"))[0]!.count_value), 2);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='HOME_COMMENT_FILE_BOOTSTRAP'");
    await send(`comment-bootstrap-shadow-${suffix}`, operatorExternalId);
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM home_comment_bootstrap_runs"))[0]!.count_value), 2);
    delete process.env.HOME_COMMENT_FILE_BOOTSTRAP_COMMAND_ENABLED;
    await app.close();
  });
});
