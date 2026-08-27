import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("home pass reform cleanup MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "home-pass-reform-token";
  const roomId = "990000000000582";
  const suffix = Date.now().toString();
  const operatorExternalId = `home-pass-reform-operator-${suffix}`;
  const unauthorizedExternalId = `home-pass-reform-user-${suffix}`;
  const homePlayerIds: bigint[] = [];

  const connect = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });

  before(async () => {
    database = connect();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='HOME_PASS_REFORM_CLEANUP'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,'synthetic','active')", [`home-pass-reform-op-${suffix}`, "합성 패스 정리 운영자"]);
    await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES (?,?,1)", [`home-pass-reform-role-${suffix}`, "합성 패스 정리 역할"]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`home-pass-reform-op-${suffix}`]))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code=?", [`home-pass-reform-role-${suffix}`]))[0]!;
    await database.execute("INSERT INTO admin_role_permissions(role_id,permission_code) VALUES (?,'game.home.moderate')", [role.id]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    for (const [externalId, displayName] of [[operatorExternalId, "합성 패스 정리 운영자"], [unauthorizedExternalId, "합성 일반 사용자"]] as const) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [player.id, displayName]);
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, externalId, displayName]);
    }
    const operatorIdentity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [operatorExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, operatorIdentity.id]);
    for (const [index, likeCount] of [3, 0, 5].entries()) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      homePlayerIds.push(player.id);
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [player.id, `합성 홈 회원 ${index + 1}`]);
      await database.execute("INSERT INTO player_homes(player_id,display_name,like_count,version) VALUES (?,?,?,1)", [player.id, `합성 홈 ${index + 1}`, likeCount]);
    }
    for (let index = 0; index < 4; index += 1) {
      await database.execute("INSERT INTO home_comments(home_player_id,author_player_id,body,status,created_at) VALUES (?,?,?,'visible',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND))", [homePlayerIds[index % 3], homePlayerIds[(index + 1) % 3], `합성 댓글 ${index + 1}`, index]);
    }
    const pinned = (await database.query<Array<{ id: bigint }>>("SELECT id FROM home_comments ORDER BY id LIMIT 1"))[0]!;
    await database.execute("INSERT INTO home_comment_pins(pin_id,home_player_id,comment_id,display_order) VALUES (?,?,?,1)", [`pass-reform-pin-${suffix}`, homePlayerIds[0], pinned.id]);
    process.env.HOME_PASS_REFORM_CLEANUP_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
  });

  after(async () => {
    delete process.env.HOME_PASS_REFORM_CLEANUP_COMMAND_ENABLED;
    delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
    if (!database) return;
    try { await database.execute("DROP TRIGGER IF EXISTS fail_home_pass_reform_audit"); await database.close(); }
    catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; }
  });

  it("authorizes, rolls back, backs up, preserves pins, replays, marks once, shadows and reconnects", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "home-pass-reform-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    let app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = (eventId: string, externalUserId: string, message = "/펫홈패스개편정리") => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화펫테스트방", sender: "합성 운영자", json: { _id: eventId, chat_id: roomId, user_id: externalUserId } } });
    const scalar = async (sql: string) => (await database.query<Array<{ value: bigint }>>(sql))[0]!.value;

    assert.equal((await send(`pass-reform-forbidden-${suffix}`, unauthorizedExternalId)).statusCode, 403);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_comments WHERE status='visible' AND deleted_at IS NULL")), 4);
    assert.equal(Number(await scalar("SELECT SUM(like_count) value FROM player_homes")), 8);

    await database.execute("CREATE TRIGGER fail_home_pass_reform_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic home pass reform audit failure'");
    assert.equal((await send(`pass-reform-rollback-${suffix}`, operatorExternalId)).statusCode, 500);
    await database.execute("DROP TRIGGER fail_home_pass_reform_audit");
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_comments WHERE status='visible' AND deleted_at IS NULL")), 4);
    assert.equal(Number(await scalar("SELECT SUM(like_count) value FROM player_homes")), 8);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_pass_reform_comment_backups")), 0);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='home.pass_reform.cleanup'")), 0);

    const successEvent = `pass-reform-success-${suffix}`;
    assert.equal((await send(successEvent, operatorExternalId)).statusCode, 202);
    assert.match(replies.at(-1)!.data, /일반 댓글 삭제: 3개/);
    assert.match(replies.at(-1)!.data, /댓글핀 유지: 1개/);
    assert.match(replies.at(-1)!.data, /좋아홈 초기화: 3명 \/ 8개/);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_comments WHERE status='pass_reform_removed' AND deleted_at IS NOT NULL")), 3);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_comments comment JOIN home_comment_pins pin ON pin.comment_id=comment.id AND pin.deleted_at IS NULL WHERE comment.status='visible' AND comment.deleted_at IS NULL")), 1);
    assert.equal(Number(await scalar("SELECT SUM(like_count) value FROM player_homes")), 0);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_pass_reform_comment_backups")), 4);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_pass_reform_home_backups")), 3);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_pass_reform_cleanup_state WHERE completed_operation_id IS NOT NULL")), 1);

    await send(successEvent, operatorExternalId);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_pass_reform_cleanup_runs")), 1);
    await send(`pass-reform-already-${suffix}`, operatorExternalId);
    assert.match(replies.at(-1)!.data, /이미 완료되었습니다/);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_pass_reform_cleanup_runs")), 2);
    const replyCount = replies.length;
    await send(`pass-reform-suffix-${suffix}`, operatorExternalId, "/펫홈패스개편정리 1");
    assert.equal(replies.length, replyCount);
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='HOME_PASS_REFORM_CLEANUP'");
    await send(`pass-reform-shadow-${suffix}`, operatorExternalId);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_pass_reform_cleanup_runs")), 2);

    const before = [await scalar("SELECT COUNT(*) value FROM home_pass_reform_cleanup_runs"), await scalar("SELECT COUNT(*) value FROM home_pass_reform_comment_backups"), await scalar("SELECT COUNT(*) value FROM home_pass_reform_home_backups"), await scalar("SELECT COUNT(*) value FROM home_comments WHERE status='pass_reform_removed'"), await scalar("SELECT SUM(like_count) value FROM player_homes")].map(String).join("/");
    await app.close();
    database = connect();
    const after = [await scalar("SELECT COUNT(*) value FROM home_pass_reform_cleanup_runs"), await scalar("SELECT COUNT(*) value FROM home_pass_reform_comment_backups"), await scalar("SELECT COUNT(*) value FROM home_pass_reform_home_backups"), await scalar("SELECT COUNT(*) value FROM home_comments WHERE status='pass_reform_removed'"), await scalar("SELECT SUM(like_count) value FROM player_homes")].map(String).join("/");
    assert.equal(after, before);
    app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }) });
    await app.close();
  });
});
