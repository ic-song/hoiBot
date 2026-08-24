import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const integrationEnabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

describe("package catalog add wizard Iris MariaDB integration", { skip: !integrationEnabled }, () => {
  let database: DatabaseClient;
  let previousWizardFlag: string | undefined;
  let previousPartialFlag: string | undefined;
  const token = "package-catalog-wizard-iris-token";
  const roomId = "990000000000211";
  const externalUserId = "package-catalog-wizard-iris-user";
  const loginId = "package-catalog-wizard-iris-operator";

  before(async () => {
    previousWizardFlag = process.env.PACKAGE_CATALOG_WIZARD_COMMAND_ENABLED;
    previousPartialFlag = process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
    process.env.PACKAGE_CATALOG_WIZARD_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    database = createDatabaseClient({
      enabled: true,
      host: required("DATABASE_HOST"),
      port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"),
      name: required("DATABASE_NAME"),
      connectionLimit: 5,
      connectTimeoutMs: 5_000,
    });
    await database.execute(
      `INSERT INTO admin_operators(login_id,display_name,password_hash,status)
       VALUES (?, '패키지 마법사 Iris 관리자', 'synthetic-not-a-password', 'active')
       ON DUPLICATE KEY UPDATE status='active'`,
      [loginId],
    );
    await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES ('package_wizard_iris','패키지 마법사 Iris 역할',1) ON DUPLICATE KEY UPDATE active=1");
    const operators = await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [loginId]);
    const roles = await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='package_wizard_iris'");
    await database.execute("INSERT IGNORE INTO admin_role_permissions(role_id,permission_code) VALUES (?,'package.catalog.manage')", [roles[0]!.id]);
    await database.execute("INSERT IGNORE INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operators[0]!.id, roles[0]!.id]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const players = await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1");
    await database.execute(
      `INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status)
       VALUES (?,'kakao',?,'패키지 마법사 Iris 관리자','linked')
       ON DUPLICATE KEY UPDATE player_id=VALUES(player_id),status='linked'`,
      [players[0]!.id, externalUserId],
    );
    const identities = await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [externalUserId]);
    await database.execute("INSERT IGNORE INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operators[0]!.id, identities[0]!.id]);
  });

  after(async () => {
    process.env.PACKAGE_CATALOG_WIZARD_COMMAND_ENABLED = previousWizardFlag;
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = previousPartialFlag;
    try { await database.close(); } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("routes exact controls and active-session text through Iris to a committed package", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({
      NODE_ENV: "test",
      IRIS_SHARED_TOKEN: token,
      USER_VERIFICATION_PEPPER: "package-catalog-wizard-iris-pepper",
      DATABASE_ENABLED: "true",
      DATABASE_HOST: required("DATABASE_HOST"),
      DATABASE_PORT: required("DATABASE_PORT"),
      DATABASE_USER: required("DATABASE_USER"),
      DATABASE_PASSWORD: required("DATABASE_PASSWORD"),
      DATABASE_NAME: required("DATABASE_NAME"),
    });
    const app = buildApp(config, {
      database,
      inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }),
      sendIrisTextReply: async (reply) => { replies.push(reply); },
    });
    const packageName = `합성 Iris 단계 패키지 ${Date.now()}`;
    let sequence = 0;
    const send = async (message: string) => {
      sequence += 1;
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/integrations/iris/events?token=${token}`,
        payload: { msg: message, room: "고도화패키지테스트방", sender: "패키지 마법사 Iris 관리자", json: { _id: `package-wizard-iris-${Date.now()}-${sequence}`, chat_id: roomId, user_id: externalUserId } },
      });
      assert.equal(response.statusCode, 202, response.body);
    };
    await send("/패키지추가시작");
    await send(packageName);
    await send("Iris 단계 입력 DB 영속 검증");
    await send("포인트");
    await send("777");
    await send("완료");
    await send("등록");
    assert.equal(replies.length, 7);
    assert.match(replies[6]?.data ?? "", /패키지.*추가/);
    const rows = await database.query<Array<{ package_count: bigint; reward_quantity: bigint; session_status: string; sent_outbox: bigint }>>(
      `SELECT
       (SELECT COUNT(*) FROM package_catalog WHERE display_name=? AND deleted_at IS NULL) AS package_count,
       (SELECT rule.quantity FROM package_catalog catalog JOIN package_reward_rules rule ON rule.package_id=catalog.package_id WHERE catalog.display_name=? AND rule.item_id='ITEM-RWD-011') AS reward_quantity,
       (SELECT session.status FROM package_catalog_wizard_sessions session JOIN admin_operators operator ON operator.id=session.operator_id WHERE operator.login_id=?) AS session_status,
       (SELECT COUNT(*) FROM outbox_messages WHERE destination_id=? AND status='sent') AS sent_outbox`,
      [packageName, packageName, loginId, roomId],
    );
    assert.deepEqual(rows[0], { package_count: 1n, reward_quantity: 777n, session_status: "COMMITTED", sent_outbox: 7n });
    await app.close();
  });
});
