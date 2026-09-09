import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("home feed migration MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "home-feed-migration-token";
  const roomId = "990000000000583";
  const suffix = Date.now().toString();
  const operatorExternalId = `home-feed-migration-operator-${suffix}`;
  const unauthorizedExternalId = `home-feed-migration-user-${suffix}`;
  const homePlayerIds: bigint[] = [];

  const connect = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });

  before(async () => {
    database = connect();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='HOME_FEED_MIGRATION'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,'synthetic','active')", [`home-feed-migration-op-${suffix}`, "합성 피드 이관 운영자"]);
    await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES (?,?,1)", [`home-feed-migration-role-${suffix}`, "합성 피드 이관 역할"]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`home-feed-migration-op-${suffix}`]))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code=?", [`home-feed-migration-role-${suffix}`]))[0]!;
    await database.execute("INSERT INTO admin_role_permissions(role_id,permission_code) VALUES (?,'game.home.moderate')", [role.id]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    for (const [externalId, displayName] of [[operatorExternalId, "합성 피드 이관 운영자"], [unauthorizedExternalId, "합성 일반 사용자"]] as const) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [player.id, displayName]);
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, externalId, displayName]);
    }
    const operatorIdentity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [operatorExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, operatorIdentity.id]);
    for (let index = 0; index < 3; index += 1) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      homePlayerIds.push(player.id);
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [player.id, `합성 피드 홈 회원 ${index + 1}`]);
      await database.execute("INSERT INTO player_homes(player_id,display_name,version) VALUES (?,?,1)", [player.id, `합성 피드 홈 ${index + 1}`]);
    }
    await database.execute("INSERT INTO home_feed_legacy_sources(player_id,legacy_content,legacy_created_at_ms,source_file,source_path) VALUES (?,?,?,'data/petSweetHomeData.json',?)", [homePlayerIds[0], "  이전 한줄평  ", 9007199254740991n, `$.합성피드홈1.comment`]);
    await database.execute("INSERT INTO home_feed_legacy_sources(player_id,legacy_content,legacy_created_at_ms,source_file,source_path) VALUES (?,NULL,NULL,'data/petSweetHomeData.json',?)", [homePlayerIds[1], `$.합성피드홈2.comment`]);
    for (let index = 1; index <= 10; index += 1) {
      await database.execute("INSERT INTO home_feeds(home_player_id,feed_key,content,display_order,created_at_ms,source_code,version) VALUES (?,?,?,?,?,'modern_fixture',1)", [homePlayerIds[0], `existing-${index}`, `기존 피드 ${index}`, index, BigInt(1700000000000 + index)]);
    }
    process.env.HOME_FEED_MIGRATION_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
  });

  after(async () => {
    delete process.env.HOME_FEED_MIGRATION_COMMAND_ENABLED;
    delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
    if (!database) return;
    try { await database.execute("DROP TRIGGER IF EXISTS fail_home_feed_migration_audit"); await database.close(); }
    catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; }
  });

  it("authorizes, rolls back, backs up, migrates all markers, caps feeds, replays, shadows and reconnects", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "home-feed-migration-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    let app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = (eventId: string, externalUserId: string, message = "/펫홈피드마이그레이션") => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화펫테스트방", sender: "합성 운영자", json: { _id: eventId, chat_id: roomId, user_id: externalUserId } } });
    const scalar = async (sql: string) => (await database.query<Array<{ value: bigint }>>(sql))[0]!.value;

    assert.equal((await send(`home-feed-forbidden-${suffix}`, unauthorizedExternalId)).statusCode, 403);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_feeds")), 10);

    await database.execute("CREATE TRIGGER fail_home_feed_migration_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic home feed migration audit failure'");
    assert.equal((await send(`home-feed-rollback-${suffix}`, operatorExternalId)).statusCode, 500);
    await database.execute("DROP TRIGGER fail_home_feed_migration_audit");
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_feeds")), 10);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_feed_migration_source_backups")), 0);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_feed_migration_markers")), 0);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='home.feed.migrate'")), 0);

    const successEvent = `home-feed-success-${suffix}`;
    assert.equal((await send(successEvent, operatorExternalId)).statusCode, 202);
    assert.match(replies.at(-1)!.data, /처리 유저: 3명/);
    assert.match(replies.at(-1)!.data, /이전 한줄평: 1개/);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_feeds WHERE home_player_id=" + homePlayerIds[0]!.toString())), 10);
    const migrated = (await database.query<Array<{ feed_key: string; content: string; display_order: bigint; created_at_ms: bigint }>>("SELECT feed_key,content,display_order,created_at_ms FROM home_feeds WHERE home_player_id=? ORDER BY display_order LIMIT 1", [homePlayerIds[0]]))[0]!;
    assert.equal(migrated.feed_key, "legacy-9007199254740991");
    assert.equal(migrated.content, "이전 한줄평");
    assert.equal(Number(migrated.display_order), 1);
    assert.equal(migrated.created_at_ms, 9007199254740991n);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_feeds WHERE home_player_id=" + homePlayerIds[0]!.toString() + " AND feed_key='existing-10'")), 0);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_feed_migration_source_backups")), 3);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_feed_migration_feed_backups")), 10);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_feed_migration_markers")), 3);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_feed_migration_markers WHERE had_legacy_feed=1")), 1);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_feed_legacy_sources WHERE migrated_operation_id IS NOT NULL")), 2);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_feed_migration_state WHERE completed_operation_id IS NOT NULL")), 1);

    await send(successEvent, operatorExternalId);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_feed_migration_runs")), 1);
    await send(`home-feed-already-${suffix}`, operatorExternalId);
    assert.match(replies.at(-1)!.data, /이미 완료되었습니다/);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_feed_migration_runs")), 2);
    const replyCount = replies.length;
    await send(`home-feed-suffix-${suffix}`, operatorExternalId, "/펫홈피드마이그레이션 1");
    assert.equal(replies.length, replyCount);
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='HOME_FEED_MIGRATION'");
    await send(`home-feed-shadow-${suffix}`, operatorExternalId);
    assert.equal(Number(await scalar("SELECT COUNT(*) value FROM home_feed_migration_runs")), 2);

    const before = [await scalar("SELECT COUNT(*) value FROM home_feed_migration_runs"), await scalar("SELECT COUNT(*) value FROM home_feed_migration_source_backups"), await scalar("SELECT COUNT(*) value FROM home_feed_migration_feed_backups"), await scalar("SELECT COUNT(*) value FROM home_feed_migration_markers"), await scalar("SELECT COUNT(*) value FROM home_feeds")].map(String).join("/");
    await app.close();
    database = connect();
    const after = [await scalar("SELECT COUNT(*) value FROM home_feed_migration_runs"), await scalar("SELECT COUNT(*) value FROM home_feed_migration_source_backups"), await scalar("SELECT COUNT(*) value FROM home_feed_migration_feed_backups"), await scalar("SELECT COUNT(*) value FROM home_feed_migration_markers"), await scalar("SELECT COUNT(*) value FROM home_feeds")].map(String).join("/");
    assert.equal(after, before);
    app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }) });
    await app.close();
  });
});
