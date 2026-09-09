import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("admin diamond edit MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "admin-diamond-edit-iris-token";
  const roomId = "990000000000260";
  const operatorExternalId = "admin-diamond-edit-operator";
  const unauthorizedExternalId = "admin-diamond-edit-unauthorized";
  const targetName = "합성 다이아 대상";
  let targetPlayerId = "";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='ADMIN_DIAMOND_EDIT'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES ('diamond-edit-op','다이아 관리자','synthetic','active')");
    await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES ('diamond-edit-role','다이아 역할',1)");
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id='diamond-edit-op'"))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='diamond-edit-role'"))[0]!;
    await database.execute("INSERT INTO admin_role_permissions(role_id,permission_code) VALUES (?,'game.currency.change')", [role.id]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const operatorPlayer = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'다이아 관리자','linked')", [operatorPlayer.id, operatorExternalId]);
    const operatorIdentity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [operatorExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, operatorIdentity.id]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const unauthorizedPlayer = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'일반 사용자','linked')", [unauthorizedPlayer.id, unauthorizedExternalId]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const target = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    targetPlayerId = target.id.toString();
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [target.id, targetName]);
    await database.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'diamond',10,1)", [target.id]);
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

  it("commits add/subtract once and keeps unauthorized, Shadow and failed audit mutation-free", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "admin-diamond-edit-pepper",
      DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
      DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (eventId: string, externalUserId: string, message: string) => app.inject({ method: "POST",
      url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg: message, room: "고도화다이아테스트방", sender: "합성 관리자", json: { _id: eventId, chat_id: roomId, user_id: externalUserId } } });

    const addEvent = `diamond-add-${Date.now()}`;
    assert.equal((await send(addEvent, operatorExternalId, `/다이아추가 ${targetName} 5`)).statusCode, 202);
    assert.equal(replies.at(-1)?.data, `✅ 다이아 추가 완료\n[${targetName}] +5 (보유 15)`);
    await send(addEvent, operatorExternalId, `/다이아추가 ${targetName} 5`);
    const addLedger = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM currency_ledger WHERE player_id=? AND reason_code='admin_diamond_add'", [targetPlayerId]);
    assert.equal(Number(addLedger[0]!.count), 1);

    const subtractEvent = `diamond-subtract-${Date.now()}`;
    assert.equal((await send(subtractEvent, operatorExternalId, `/다이아차감 ${targetName} 20`)).statusCode, 202);
    assert.equal(replies.at(-1)?.data, `✅ 다이아 차감 완료\n[${targetName}] -15 (보유 0)`);
    let balance = (await database.query<Array<{ balance: string }>>("SELECT CAST(balance AS CHAR) AS balance FROM currency_accounts WHERE player_id=? AND currency_code='diamond'", [targetPlayerId]))[0]!;
    assert.equal(balance.balance, "0.000");

    await send(`diamond-forbidden-${Date.now()}`, unauthorizedExternalId, `/다이아추가 ${targetName} 9`);
    balance = (await database.query<Array<{ balance: string }>>("SELECT CAST(balance AS CHAR) AS balance FROM currency_accounts WHERE player_id=? AND currency_code='diamond'", [targetPlayerId]))[0]!;
    assert.equal(balance.balance, "0.000");

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='ADMIN_DIAMOND_EDIT'");
    const shadowEvent = `diamond-shadow-${Date.now()}`;
    await send(shadowEvent, operatorExternalId, `/다이아추가 ${targetName} 7`);
    balance = (await database.query<Array<{ balance: string }>>("SELECT CAST(balance AS CHAR) AS balance FROM currency_accounts WHERE player_id=? AND currency_code='diamond'", [targetPlayerId]))[0]!;
    assert.equal(balance.balance, "0.000");
    const route = (await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${shadowEvent}`]))[0]!;
    assert.equal(route.route, "SHADOW");

    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='ADMIN_DIAMOND_EDIT'");
    await database.execute("CREATE TRIGGER synthetic_admin_diamond_audit_failure BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic audit failure'");
    const failed = await send(`diamond-rollback-${Date.now()}`, operatorExternalId, `/다이아추가 ${targetName} 3`);
    assert.equal(failed.statusCode, 500);
    await database.execute("DROP TRIGGER synthetic_admin_diamond_audit_failure");
    balance = (await database.query<Array<{ balance: string }>>("SELECT CAST(balance AS CHAR) AS balance FROM currency_accounts WHERE player_id=? AND currency_code='diamond'", [targetPlayerId]))[0]!;
    assert.equal(balance.balance, "0.000");
    await app.close();
  });
});
