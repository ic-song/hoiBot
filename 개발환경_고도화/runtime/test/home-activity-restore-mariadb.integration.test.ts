import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("home activity restore MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "home-activity-restore-token";
  const roomId = "990000000000584";
  const suffix = Date.now().toString();
  const operatorExternalId = `home-activity-restore-operator-${suffix}`;
  const unauthorizedExternalId = `home-activity-restore-user-${suffix}`;
  const ownerExternalId = `home-activity-owner-${suffix}`;
  const visitorExternalId = `home-activity-visitor-${suffix}`;
  let ownerPlayerId = 0n;
  let visitorPlayerId = 0n;

  const connect = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
  const addPlayer = async (externalId: string, displayName: string, withHome = false): Promise<bigint> => {
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [player.id, displayName]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, externalId, displayName]);
    if (withHome) await database.execute("INSERT INTO player_homes(player_id,display_name,version) VALUES (?,?,1)", [player.id, `${displayName} 홈`]);
    return player.id;
  };

  before(async () => {
    database = connect();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='HOME_ACTIVITY_RESTORE'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,'synthetic','active')", [`home-activity-restore-op-${suffix}`, "합성 활동 복구 운영자"]);
    await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES (?,?,1)", [`home-activity-restore-role-${suffix}`, "합성 활동 복구 역할"]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`home-activity-restore-op-${suffix}`]))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code=?", [`home-activity-restore-role-${suffix}`]))[0]!;
    await database.execute("INSERT INTO admin_role_permissions(role_id,permission_code) VALUES (?,'game.home.moderate')", [role.id]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    await addPlayer(operatorExternalId, "합성 활동 복구 운영자");
    await addPlayer(unauthorizedExternalId, "합성 일반 사용자");
    ownerPlayerId = await addPlayer(ownerExternalId, "합성 활동 홈 회원", true);
    visitorPlayerId = await addPlayer(visitorExternalId, "합성 방문 회원", true);
    const operatorIdentity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [operatorExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, operatorIdentity.id]);
    process.env.HOME_ACTIVITY_RESTORE_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
  });

  after(async () => {
    delete process.env.HOME_ACTIVITY_RESTORE_COMMAND_ENABLED;
    delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
    if (!database) return;
    try { await database.execute("DROP TRIGGER IF EXISTS fail_home_activity_restore_audit"); await database.close(); }
    catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; }
  });

  it("handles missing and invalid backups, authorization, rollback, replacement, replay, shadow and reconnect", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "home-activity-restore-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    let app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = (eventId: string, externalUserId: string, message = "/펫홈활동살리기") => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화펫테스트방", sender: "합성 운영자", json: { _id: eventId, chat_id: roomId, user_id: externalUserId } } });
    const scalar = async (sql: string, params: unknown[] = []) => (await database.query<Array<{ value: bigint }>>(sql, params))[0]!.value;

    assert.equal((await send(`home-activity-forbidden-${suffix}`, unauthorizedExternalId)).statusCode, 403);
    assert.equal((await send(`home-activity-missing-${suffix}`, operatorExternalId)).statusCode, 202);
    assert.equal(replies.at(-1)!.data, "❌ 펫홈 활동 백업 파일이 없습니다.");

    await database.execute("INSERT INTO pet_home_activity_restore_sources(backup_key,source_file,source_path,source_root_hash) VALUES ('legacy_pet_home_activity','data/petHomeActivityData_back.json','/sdcard/호이랜드/petHomeActivityData_back.json',REPEAT('a',64))");
    await database.execute("INSERT INTO pet_home_activity_restore_source_social VALUES ('legacy_pet_home_activity',?,'2026-08-27',2,'S01',1,1,3,4,5,6)", [ownerExternalId]);
    await database.execute("INSERT INTO pet_home_activity_restore_source_social VALUES ('legacy_pet_home_activity',?,'2026-08-27',0,NULL,1,1,0,0,0,1)", [visitorExternalId]);
    await database.execute("INSERT INTO pet_home_activity_restore_source_relations VALUES ('legacy_pet_home_activity',?,'following',?,0)", [ownerExternalId, visitorExternalId]);
    assert.equal((await send(`home-activity-invalid-${suffix}`, operatorExternalId)).statusCode, 202);
    assert.equal(replies.at(-1)!.data, "❌ 펫홈 활동 백업 복구에 실패했습니다.");
    await database.execute("INSERT INTO pet_home_activity_restore_source_relations VALUES ('legacy_pet_home_activity',?,'followers',?,0)", [visitorExternalId, ownerExternalId]);
    await database.execute("INSERT INTO pet_home_activity_restore_source_badges VALUES ('legacy_pet_home_activity',?,'owned','S01',1)", [ownerExternalId]);
    await database.execute("INSERT INTO pet_home_activity_restore_source_badges VALUES ('legacy_pet_home_activity',?,'deleted','S02',1)", [ownerExternalId]);
    await database.execute("INSERT INTO pet_home_activity_restore_source_feed_days VALUES ('legacy_pet_home_activity',?,'2026-08-26',0)", [ownerExternalId]);
    await database.execute("INSERT INTO pet_home_activity_restore_source_alerts VALUES ('legacy_pet_home_activity',?,0,'feed',?,'2026-08-27T10:00:00.000Z',0,'합성 알림',NULL,'합성 방문 회원','feed-1','합성 피드',1,2)", [ownerExternalId, visitorExternalId]);
    await database.execute("INSERT INTO pet_home_activity_restore_source_visitors VALUES ('legacy_pet_home_activity',?,0,?,'2026-08-27T11:00:00.000Z')", [ownerExternalId, visitorExternalId]);
    await database.execute("INSERT INTO pet_home_activity_restore_source_special_logs VALUES ('legacy_pet_home_activity',?,0,'S01','grant',?,'2026-08-27T12:00:00.000Z')", [ownerExternalId, operatorExternalId]);
    await database.execute("INSERT INTO pet_home_activity_restore_source_migrations VALUES ('legacy_pet_home_activity','social_v2',JSON_OBJECT('done',TRUE))");

    await database.execute("INSERT INTO pet_home_follows(follower_player_id,followed_player_id) VALUES (?,?)", [visitorPlayerId, ownerPlayerId]);
    await database.execute("INSERT INTO pet_home_badge_stats(player_id,followers,mutual,received_comments,received_home_likes,received_reactions,total_visits,feed_active_days) VALUES (?,9,9,9,9,9,9,9)", [ownerPlayerId]);
    await database.execute("CREATE TRIGGER fail_home_activity_restore_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic home activity restore audit failure'");
    assert.equal((await send(`home-activity-rollback-${suffix}`, operatorExternalId)).statusCode, 500);
    await database.execute("DROP TRIGGER fail_home_activity_restore_audit");
    assert.equal(await scalar("SELECT COUNT(*) value FROM pet_home_follows WHERE follower_player_id=? AND followed_player_id=?", [visitorPlayerId, ownerPlayerId]), 1n);
    assert.equal(await scalar("SELECT COUNT(*) value FROM pet_home_activity_restore_backups"), 0n);
    assert.equal(await scalar("SELECT COUNT(*) value FROM legacy_import_runs WHERE mode='RESTORE'"), 0n);

    const successEvent = `home-activity-success-${suffix}`;
    assert.equal((await send(successEvent, operatorExternalId)).statusCode, 202);
    assert.equal(replies.at(-1)!.data, "✅ 펫홈 활동 데이터를 직전 정상 백업으로 복구했습니다.");
    assert.equal(await scalar("SELECT COUNT(*) value FROM pet_home_follows WHERE follower_player_id=? AND followed_player_id=?", [ownerPlayerId, visitorPlayerId]), 1n);
    assert.equal(await scalar("SELECT COUNT(*) value FROM pet_home_follows WHERE follower_player_id=? AND followed_player_id=?", [visitorPlayerId, ownerPlayerId]), 0n);
    assert.equal(await scalar("SELECT COUNT(*) value FROM pet_home_activity_alerts"), 1n);
    assert.equal(await scalar("SELECT COUNT(*) value FROM pet_home_recent_visitors"), 1n);
    assert.equal(await scalar("SELECT COUNT(*) value FROM player_home_badges WHERE player_id=? AND badge_code='S01' AND owned=1 AND equipped=1", [ownerPlayerId]), 1n);
    assert.equal(await scalar("SELECT COUNT(*) value FROM player_badge_assignments WHERE player_id=? AND badge_code='S01'", [ownerPlayerId]), 1n);
    assert.equal(await scalar("SELECT COUNT(*) value FROM player_home_badge_exclusions WHERE player_id=? AND badge_code='S02'", [ownerPlayerId]), 1n);
    assert.equal(await scalar("SELECT COUNT(*) value FROM pet_home_feed_activity_days WHERE player_id=?", [ownerPlayerId]), 1n);
    assert.equal(await scalar("SELECT COUNT(*) value FROM pet_home_special_badge_logs"), 1n);
    assert.equal(await scalar("SELECT COUNT(*) value FROM pet_home_activity_migration_markers"), 1n);
    assert.ok(await scalar("SELECT COUNT(*) value FROM pet_home_activity_restore_backups") >= 2n);
    assert.equal(await scalar("SELECT COUNT(*) value FROM pet_home_activity_restore_sources WHERE backup_key='legacy_pet_home_activity'"), 1n);

    await send(successEvent, operatorExternalId);
    assert.equal(await scalar("SELECT COUNT(*) value FROM pet_home_activity_restore_runs WHERE result_code='restored'"), 1n);
    const replyCount = replies.length;
    await send(`home-activity-suffix-${suffix}`, operatorExternalId, "/펫홈활동살리기 1");
    assert.equal(replies.length, replyCount);
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='HOME_ACTIVITY_RESTORE'");
    await send(`home-activity-shadow-${suffix}`, operatorExternalId);
    assert.equal(await scalar("SELECT COUNT(*) value FROM pet_home_activity_restore_runs WHERE result_code='restored'"), 1n);

    const beforeRestart = [await scalar("SELECT COUNT(*) value FROM pet_home_activity_alerts"), await scalar("SELECT COUNT(*) value FROM pet_home_recent_visitors"), await scalar("SELECT COUNT(*) value FROM pet_home_activity_restore_backups"), await scalar("SELECT COUNT(*) value FROM pet_home_activity_restore_sources")].map(String).join("/");
    await app.close();
    database = connect();
    const afterRestart = [await scalar("SELECT COUNT(*) value FROM pet_home_activity_alerts"), await scalar("SELECT COUNT(*) value FROM pet_home_recent_visitors"), await scalar("SELECT COUNT(*) value FROM pet_home_activity_restore_backups"), await scalar("SELECT COUNT(*) value FROM pet_home_activity_restore_sources")].map(String).join("/");
    assert.equal(afterRestart, beforeRestart);
    app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }) });
    await app.close();
  });
});
