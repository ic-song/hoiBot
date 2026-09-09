import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("admin hoiland edit MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "admin-hoiland-edit-iris-token";
  const roomId = "990000000000439";
  const suffix = Date.now().toString();
  const operatorExternalId = `admin-hoiland-edit-${suffix}`;
  const targetName = `합성 수정 대상 ${suffix}`;
  let targetPlayerId = "";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='ADMIN_HOILAND_EDIT'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,?,'active')", [`hoiland-${suffix}`, "호이랜드 관리자", "synthetic"]);
    await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES (?,?,1)", [`hoiland-role-${suffix}`, "호이랜드 역할"]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`hoiland-${suffix}`]))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code=?", [`hoiland-role-${suffix}`]))[0]!;
    await database.execute("INSERT INTO admin_role_permissions(role_id,permission_code) VALUES (?,'game.currency.change')", [role.id]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const operatorPlayer = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'호이랜드 관리자','linked')", [operatorPlayer.id, operatorExternalId]);
    const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [operatorExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const target = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    targetPlayerId = target.id.toString();
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [target.id, targetName]);
    await database.execute("INSERT INTO hoiland_categories(category_key,display_name,display_order) VALUES ('synthetic-a','합성 A',1),('synthetic-b','합성 B',2)");
    await database.execute("INSERT INTO hoiland_entries(category_id,player_id,amount,version) SELECT id,?,CASE category_key WHEN 'synthetic-a' THEN 10 ELSE 20 END,1 FROM hoiland_categories", [target.id]);
  });

  after(async () => {
    if (!database) return;
    try { await database.close(); } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("commits every category once and leaves Shadow mutation-free", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "admin-hoiland-pepper",
      DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
      DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const eventId = `hoiland-edit-${Date.now()}`;
    const payload = { msg: `/수정 ${targetName} 250`, room: "고도화운영테스트방", sender: "호이랜드 관리자", json: { _id: eventId, chat_id: roomId, user_id: operatorExternalId } };
    const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload });
    assert.equal(response.statusCode, 202, response.body);
    assert.equal(replies.at(-1)?.data, `[${targetName}] 가 변경되었습니다.`);
    const queuedReplies = await database.query<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS count FROM outbox_messages outbox
       JOIN command_executions execution ON execution.operation_id=outbox.operation_id
       WHERE execution.event_id=? AND execution.command_code='admin_hoiland_edit'`, [`iris:${eventId}`]
    );
    assert.equal(Number(queuedReplies[0]!.count), 2);
    const entries = await database.query<Array<{ amount: string }>>("SELECT CAST(amount AS CHAR) AS amount FROM hoiland_entries WHERE player_id=? ORDER BY id", [targetPlayerId]);
    assert.deepEqual(entries.map((entry) => entry.amount), ["250", "250"]);
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload });
    const mutations = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM hoiland_edit_mutations WHERE player_id=?", [targetPlayerId]);
    assert.equal(Number(mutations[0]!.count), 1);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='ADMIN_HOILAND_EDIT'");
    const shadowId = `hoiland-shadow-${Date.now()}`;
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { ...payload, msg: `/수정 ${targetName} 999`, json: { ...payload.json, _id: shadowId } } });
    const afterShadow = await database.query<Array<{ amount: string }>>("SELECT CAST(amount AS CHAR) AS amount FROM hoiland_entries WHERE player_id=? ORDER BY id", [targetPlayerId]);
    assert.deepEqual(afterShadow.map((entry) => entry.amount), ["250", "250"]);
    const route = (await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${shadowId}`]))[0]!;
    assert.equal(route.route, "SHADOW");
    await app.close();
  });
});
