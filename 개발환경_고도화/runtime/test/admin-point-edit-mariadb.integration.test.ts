import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("admin point edit MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "admin-point-edit-iris-token";
  const roomId = "990000000000229";
  const operatorExternalId = "admin-point-edit-operator";
  const targetName = "합성 포인트 대상";
  let targetPlayerId = "";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='ADMIN_POINT_EDIT'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES ('point-edit-op','포인트 관리자','synthetic','active') ON DUPLICATE KEY UPDATE status='active'");
    await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES ('point-edit-role','포인트 역할',1) ON DUPLICATE KEY UPDATE active=1");
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id='point-edit-op'"))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='point-edit-role'"))[0]!;
    await database.execute("INSERT IGNORE INTO admin_role_permissions(role_id,permission_code) VALUES (?,'game.currency.change')", [role.id]);
    await database.execute("INSERT IGNORE INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const operatorPlayer = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'포인트 관리자','linked')", [operatorPlayer.id, operatorExternalId]);
    const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [operatorExternalId]))[0]!;
    await database.execute("INSERT IGNORE INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const target = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    targetPlayerId = target.id.toString();
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [target.id, targetName]);
    await database.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',100,1)", [target.id]);
  });

  after(async () => {
    if (!database) return;
    try {
      await database.close();
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("commits absolute balance once and leaves Shadow mutation-free", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "admin-point-edit-pepper",
      DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
      DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const eventId = `point-edit-${Date.now()}`;
    const payload = { msg: `/포인트수정 ${targetName} 250`, room: "고도화포인트테스트방", sender: "포인트 관리자", json: { _id: eventId, chat_id: roomId, user_id: operatorExternalId } };
    const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload });
    assert.equal(response.statusCode, 202, response.body);
    assert.equal(replies.at(-1)?.data, `✅ 포인트 수정 완료\n[${targetName}] 100 → 250`);
    const account = (await database.query<Array<{ balance: string }>>("SELECT CAST(balance AS CHAR) AS balance FROM currency_accounts WHERE player_id=? AND currency_code='point'", [targetPlayerId]))[0]!;
    assert.equal(account.balance, "250.000");
    const ledger = await database.query<Array<{ delta: string }>>("SELECT CAST(delta AS CHAR) AS delta FROM currency_ledger WHERE player_id=? AND reason_code='admin_point_edit'", [targetPlayerId]);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0]!.delta, "150.000");
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload });
    const replayLedger = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM currency_ledger WHERE player_id=? AND reason_code='admin_point_edit'", [targetPlayerId]);
    assert.equal(Number(replayLedger[0]!.count), 1);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='ADMIN_POINT_EDIT'");
    const shadowEventId = `point-edit-shadow-${Date.now()}`;
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { ...payload, msg: `/포인트수정 ${targetName} 999`, json: { ...payload.json, _id: shadowEventId } } });
    const afterShadow = (await database.query<Array<{ balance: string }>>("SELECT CAST(balance AS CHAR) AS balance FROM currency_accounts WHERE player_id=? AND currency_code='point'", [targetPlayerId]))[0]!;
    assert.equal(afterShadow.balance, "250.000");
    const route = (await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${shadowEventId}`]))[0]!;
    assert.equal(route.route, "SHADOW");
    await app.close();
  });
});
