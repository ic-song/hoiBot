import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("home social badge migration MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  let app: ReturnType<typeof buildApp>;
  const token = "home-social-badge-token";
  const roomId = "990000000000580";
  const suffix = Date.now().toString();
  const operatorExternalId = `home-social-badge-operator-${suffix}`;
  const unauthorizedExternalId = `home-social-badge-user-${suffix}`;
  let targetPlayerId = 0n;

  const config = () => loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "home-social-badge-pepper",
    DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"),
    DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
  const build = () => buildApp(config(), { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
    evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
  const replies: Array<{ room: string; data: string }> = [];
  const send = async (eventId: string, externalUserId: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
    payload: { msg: "/펫홈소셜뱃지마이그레이션", room: "고도화펫테스트방", sender: "합성 운영자", json: { _id: eventId, chat_id: roomId, user_id: externalUserId } } });

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='HOME_SOCIAL_BADGE_MIGRATION'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,'synthetic','active')", [`home-social-badge-op-${suffix}`, "합성 펫홈 운영자"]);
    await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES (?,?,1)", [`home-social-badge-role-${suffix}`, "합성 펫홈 역할"]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`home-social-badge-op-${suffix}`]))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code=?", [`home-social-badge-role-${suffix}`]))[0]!;
    await database.execute("INSERT INTO admin_role_permissions(role_id,permission_code) VALUES (?,'game.home.moderate')", [role.id]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    for (const identity of [[operatorExternalId, "합성 펫홈 운영자"], [unauthorizedExternalId, "합성 일반 사용자"]] as const) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, identity[0], identity[1]]);
    }
    const operatorIdentity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [operatorExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, operatorIdentity.id]);

    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    targetPlayerId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!.id;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'합성 소셜 홈',1)", [targetPlayerId]);
    await database.execute("INSERT INTO player_homes(player_id,display_name,like_count,visit_count,version) VALUES (?,'합성 소셜 홈',10,10,1)", [targetPlayerId]);
    await database.execute("INSERT INTO player_badge_assignments(player_id,badge_code,display_value,priority) VALUES (?,'S01','🎂 펫홈 1주년',100)", [targetPlayerId]);
    await database.execute("INSERT INTO player_badge_equipment(player_id,equipped_badge_code,version) VALUES (?,'S01',3)", [targetPlayerId]);
    await database.execute("INSERT INTO player_home_badges(player_id,badge_code,owned,equipped,version) VALUES (?,'S01',TRUE,TRUE,1)", [targetPlayerId]);
    await database.execute("INSERT INTO player_home_badge_exclusions(player_id,badge_code) VALUES (?,'C01')", [targetPlayerId]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const actor = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!.id;
    for (let index = 0; index < 10; index++) await database.execute("INSERT INTO home_comments(home_player_id,author_player_id,body,status) VALUES (?,?,'합성 댓글','visible')", [targetPlayerId, actor]);
    await database.execute("INSERT INTO home_reactions(home_player_id,actor_player_id,reaction_code) VALUES (?,?,'cute')", [targetPlayerId, actor]);
    process.env.HOME_SOCIAL_BADGE_MIGRATION_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    app = build();
  });

  after(async () => {
    delete process.env.HOME_SOCIAL_BADGE_MIGRATION_COMMAND_ENABLED;
    if (app) await app.close();
    if (database) {
      try { await database.execute("DROP TRIGGER IF EXISTS fail_home_social_badge_audit"); await database.close(); }
      catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; }
    }
  });

  it("blocks unauthorized, rolls back, migrates once, preserves equipment, replays, restarts and shadows", async () => {
    assert.equal((await send(`home-social-badge-forbidden-${suffix}`, unauthorizedExternalId)).statusCode, 403);
    await database.execute("CREATE TRIGGER fail_home_social_badge_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic home social badge audit failure'");
    assert.equal((await send(`home-social-badge-rollback-${suffix}`, operatorExternalId)).statusCode, 500);
    await database.execute("DROP TRIGGER fail_home_social_badge_audit");
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM pet_home_social_badge_migration_awards"))[0]!.count_value), 0);
    assert.equal(Number((await database.query<Array<{ applied: number }>>("SELECT applied FROM pet_home_social_badge_migration_state WHERE migration_key='pet_home_social_badges_20260727'"))[0]!.applied), 0);

    const successEvent = `home-social-badge-success-${suffix}`;
    const success = await send(successEvent, operatorExternalId);
    assert.equal(success.statusCode, 202, success.body);
    assert.match(replies.at(-1)!.data, /기존 업적 지급: 6개/);
    const snapshot = (await database.query<Array<{ comments: string; likes: string; reactions: string; visits: string; awards: bigint; excluded: bigint; special: bigint; equipped: string | null }>>(
      `SELECT CAST(stats.received_comments AS CHAR) comments,CAST(stats.received_home_likes AS CHAR) likes,
        CAST(stats.received_reactions AS CHAR) reactions,CAST(stats.total_visits AS CHAR) visits,
        (SELECT COUNT(*) FROM pet_home_social_badge_migration_awards award WHERE award.player_id=stats.player_id) awards,
        (SELECT COUNT(*) FROM player_badge_assignments assignment WHERE assignment.player_id=stats.player_id AND assignment.badge_code='C01') excluded,
        (SELECT COUNT(*) FROM player_badge_assignments assignment WHERE assignment.player_id=stats.player_id AND assignment.badge_code='S01') special,
        (SELECT equipped_badge_code FROM player_badge_equipment equipment WHERE equipment.player_id=stats.player_id) equipped
       FROM pet_home_badge_stats stats WHERE stats.player_id=?`, [targetPlayerId],
    ))[0]!;
    assert.deepEqual([snapshot.comments, snapshot.likes, snapshot.reactions, snapshot.visits], ["10", "10", "1", "10"]);
    assert.deepEqual([Number(snapshot.awards), Number(snapshot.excluded), Number(snapshot.special), snapshot.equipped], [6, 0, 1, "S01"]);
    await send(successEvent, operatorExternalId);
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM pet_home_social_badge_migration_runs"))[0]!.count_value), 1);
    await send(`home-social-badge-already-${suffix}`, operatorExternalId);
    assert.match(replies.at(-1)!.data, /이미 완료/);
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM pet_home_social_badge_migration_awards"))[0]!.count_value), 6);

    await app.close();
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    app = build();
    await send(`home-social-badge-restart-${suffix}`, operatorExternalId);
    assert.match(replies.at(-1)!.data, /이미 완료/);
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM pet_home_social_badge_migration_runs"))[0]!.count_value), 3);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='HOME_SOCIAL_BADGE_MIGRATION'");
    await send(`home-social-badge-shadow-${suffix}`, operatorExternalId);
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM pet_home_social_badge_migration_runs"))[0]!.count_value), 3);
  });
});
