import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { HomeSocialService } from "../src/home/home-social-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("home visit reset MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "home-visit-reset-token";
  const roomId = "990000000000579";
  const suffix = Date.now().toString();
  const operatorExternalId = `home-visit-reset-operator-${suffix}`;
  const unauthorizedExternalId = `home-visit-reset-user-${suffix}`;
  const homePlayerIds: string[] = [];
  let visitorPlayerId = "";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='HOME_VISIT_RESET'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,'synthetic','active')", [`home-visit-reset-op-${suffix}`, "합성 펫홈 운영자"]);
    await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES (?,?,1)", [`home-visit-reset-role-${suffix}`, "합성 펫홈 역할"]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`home-visit-reset-op-${suffix}`]))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code=?", [`home-visit-reset-role-${suffix}`]))[0]!;
    await database.execute("INSERT INTO admin_role_permissions(role_id,permission_code) VALUES (?,'game.home.moderate')", [role.id]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    for (const identity of [[operatorExternalId, "합성 펫홈 운영자"], [unauthorizedExternalId, "합성 일반 사용자"]] as const) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, identity[0], identity[1]]);
    }
    const operatorIdentity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [operatorExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, operatorIdentity.id]);
    for (const count of [3, 2]) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      homePlayerIds.push(player.id.toString());
      await database.execute("INSERT INTO player_homes(player_id,display_name,visit_count,version) VALUES (?,?,?,1)", [player.id, `합성 홈 ${count}`, count]);
    }
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const visitor = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    visitorPlayerId = visitor.id.toString();
    for (let index = 0; index < 3; index++) await database.execute("INSERT INTO home_visits(home_player_id,visitor_player_id) VALUES (?,?)", [homePlayerIds[0], visitor.id]);
  });

  after(async () => {
    if (!database) return;
    try {
      await database.execute("DROP TRIGGER IF EXISTS fail_home_visit_reset_audit");
      await database.close();
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("blocks unauthorized, rolls back, resets counters, preserves history, increments new visits, replays and shadows", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "home-visit-reset-pepper",
      DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"),
      DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    process.env.HOME_VISIT_RESET_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (eventId: string, externalUserId: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg: "/펫홈방문초기화", room: "고도화펫테스트방", sender: "합성 운영자", json: { _id: eventId, chat_id: roomId, user_id: externalUserId } } });
    const totalCounter = async () => Number((await database.query<Array<{ total_value: string }>>("SELECT CAST(SUM(visit_count) AS CHAR) total_value FROM player_homes"))[0]!.total_value);
    const visitRows = async () => Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM home_visits"))[0]!.count_value);

    assert.equal((await send(`home-visit-reset-forbidden-${suffix}`, unauthorizedExternalId)).statusCode, 403);
    assert.equal(await totalCounter(), 5);

    await database.execute("CREATE TRIGGER fail_home_visit_reset_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic home visit reset audit failure'");
    assert.equal((await send(`home-visit-reset-rollback-${suffix}`, operatorExternalId)).statusCode, 500);
    await database.execute("DROP TRIGGER fail_home_visit_reset_audit");
    assert.equal(await totalCounter(), 5);
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM operations WHERE idempotency_scope='home.visit.reset'"))[0]!.count_value), 0);

    const resetEvent = `home-visit-reset-success-${suffix}`;
    const reset = await send(resetEvent, operatorExternalId);
    assert.equal(reset.statusCode, 202, reset.body);
    assert.match(replies.at(-1)!.data, /초기화된 유저 수: 2명/);
    assert.equal(await totalCounter(), 0);
    assert.equal(await visitRows(), 3);
    await send(resetEvent, operatorExternalId);
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM home_visit_reset_runs"))[0]!.count_value), 1);

    await new HomeSocialService(database).visit({ homePlayerId: homePlayerIds[0]!, actorPlayerId: visitorPlayerId, reason: "합성 방문 증가", idempotencyKey: `home-visit-after-reset-${suffix}`, actor: { type: "system" }, sourceCode: "system" });
    assert.equal(await totalCounter(), 1);
    assert.equal(await visitRows(), 4);
    await send(`home-visit-reset-second-${suffix}`, operatorExternalId);
    assert.equal(await totalCounter(), 0);
    assert.equal(await visitRows(), 4);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='HOME_VISIT_RESET'");
    await send(`home-visit-reset-shadow-${suffix}`, operatorExternalId);
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM home_visit_reset_runs"))[0]!.count_value), 2);
    delete process.env.HOME_VISIT_RESET_COMMAND_ENABLED;
    await app.close();
  });
});
