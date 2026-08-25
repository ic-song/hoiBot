import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("admin diamond reset all MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "admin-diamond-reset-token";
  const roomId = "990000000000262";
  const operatorExternalId = "admin-diamond-reset-operator";
  const unauthorizedExternalId = "admin-diamond-reset-unauthorized";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='ADMIN_DIAMOND_RESET_ALL'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES ('diamond-reset-op','다이아 초기화 관리자','synthetic','active')");
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id='diamond-reset-op'"))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='super_admin'"))[0]!;
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    for (const [externalId, displayName] of [[operatorExternalId, "다이아 초기화 관리자"], [unauthorizedExternalId, "일반 사용자"]]) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, externalId, displayName]);
      if (externalId === operatorExternalId) {
        const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [externalId]))[0]!;
        await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
      }
    }
    for (const balance of ["10", "0", "25"]) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'diamond',?,1)", [player.id, balance]);
    }
  });

  after(async () => {
    if (!database) return;
    try { await database.close(); } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("confirms, resets atomically, replays, blocks unauthorized/Shadow and rolls back ledger failure", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "admin-diamond-reset-pepper",
      DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
      DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (eventId: string, externalUserId: string, message: string) => app.inject({ method: "POST",
      url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg: message, room: "고도화다이아초기화방", sender: "합성 관리자", json: { _id: eventId, chat_id: roomId, user_id: externalUserId } } });

    const requestEvent = `diamond-reset-request-${Date.now()}`;
    assert.equal((await send(requestEvent, operatorExternalId, "/다이아전체초기화")).statusCode, 202);
    const code = /확인 ([A-F0-9]{8})$/.exec(replies.at(-1)!.data)?.[1];
    assert.ok(code);
    let sum = (await database.query<Array<{ total: string }>>("SELECT CAST(SUM(balance) AS CHAR) AS total FROM currency_accounts WHERE currency_code='diamond'"))[0]!;
    assert.equal(sum.total, "35.000");

    const confirmEvent = `diamond-reset-confirm-${Date.now()}`;
    assert.equal((await send(confirmEvent, operatorExternalId, `/다이아전체초기화 확인 ${code}`)).statusCode, 202);
    assert.match(replies.at(-1)!.data, /잔액 변경 2명$/);
    sum = (await database.query<Array<{ total: string }>>("SELECT CAST(SUM(balance) AS CHAR) AS total FROM currency_accounts WHERE currency_code='diamond'"))[0]!;
    assert.equal(sum.total, "0.000");
    let ledgers = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM currency_ledger WHERE reason_code='admin_diamond_reset_all'");
    assert.equal(Number(ledgers[0]!.count), 2);
    await send(confirmEvent, operatorExternalId, `/다이아전체초기화 확인 ${code}`);
    ledgers = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM currency_ledger WHERE reason_code='admin_diamond_reset_all'");
    assert.equal(Number(ledgers[0]!.count), 2);

    await send(`diamond-reset-forbidden-${Date.now()}`, unauthorizedExternalId, "/다이아전체초기화");
    const forbiddenConfirmations = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM admin_currency_reset_confirmations WHERE operator_id IS NULL");
    assert.equal(Number(forbiddenConfirmations[0]!.count), 0);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='ADMIN_DIAMOND_RESET_ALL'");
    const shadowEvent = `diamond-reset-shadow-${Date.now()}`;
    await send(shadowEvent, operatorExternalId, "/다이아전체초기화");
    const route = (await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${shadowEvent}`]))[0]!;
    assert.equal(route.route, "SHADOW");

    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='ADMIN_DIAMOND_RESET_ALL'");
    await database.execute("UPDATE currency_accounts SET balance=CASE WHEN balance=0 THEN 4 ELSE balance END,version=version+1 WHERE currency_code='diamond' LIMIT 1");
    const rollbackRequest = `diamond-reset-rollback-request-${Date.now()}`;
    await send(rollbackRequest, operatorExternalId, "/다이아전체초기화");
    const rollbackCode = /확인 ([A-F0-9]{8})$/.exec(replies.at(-1)!.data)?.[1];
    assert.ok(rollbackCode);
    await database.execute("CREATE TRIGGER synthetic_diamond_reset_ledger_failure BEFORE INSERT ON currency_ledger FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic reset ledger failure'");
    const failed = await send(`diamond-reset-failed-${Date.now()}`, operatorExternalId, `/다이아전체초기화 확인 ${rollbackCode}`);
    assert.equal(failed.statusCode, 500);
    await database.execute("DROP TRIGGER synthetic_diamond_reset_ledger_failure");
    sum = (await database.query<Array<{ total: string }>>("SELECT CAST(SUM(balance) AS CHAR) AS total FROM currency_accounts WHERE currency_code='diamond'"))[0]!;
    assert.equal(sum.total, "4.000");
    assert.equal((await send(`diamond-reset-retry-${Date.now()}`, operatorExternalId, `/다이아전체초기화 확인 ${rollbackCode}`)).statusCode, 202);
    await app.close();
  });
});
