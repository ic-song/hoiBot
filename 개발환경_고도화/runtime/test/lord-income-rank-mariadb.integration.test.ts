import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

// Iris 이벤트 수신 뒤 백그라운드 명령 실행과 응답 완료를 제한 시간 안에서 기다립니다.
async function waitForReply(replies: Array<{ room: string; data: string }>, count: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (replies.length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(replies.length >= count, true, "Iris reply was not delivered within 5 seconds");
}

describe("lord income rank MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const suffix = Date.now().toString();
  const token = "lord-income-iris-token";
  const roomId = "990000000000440";
  const operatorExternalId = `lord-income-admin-${suffix}`;

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code IN ('LORD_INCOME_RANK_READ','ADMIN_LORD_INCOME_RESET')");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,?,'active')", [`lord-${suffix}`, "영주 관리자", "synthetic"]);
    await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES (?,?,1)", [`lord-role-${suffix}`, "영주 역할"]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`lord-${suffix}`]))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code=?", [`lord-role-${suffix}`]))[0]!;
    await database.execute("INSERT INTO admin_role_permissions(role_id,permission_code) VALUES (?,'game.currency.change')", [role.id]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const adminPlayer = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'영주 관리자','linked')", [adminPlayer.id, operatorExternalId]);
    const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [operatorExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
    for (let index = 1; index <= 11; index += 1) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [player.id, `영주회원${index}`]);
      await database.execute("INSERT INTO player_lord_earnings(player_id,amount,version) VALUES (?,?,1)", [player.id, (12 - index) * 1000]);
    }
  });

  after(async () => { if (database) { try { await database.close(); } catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; } } });

  it("reads eleven rows, resets once and keeps Shadow mutation-free", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "lord-income-pepper", DATABASE_ENABLED: "true",
      DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"),
      DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const readId = `lord-read-${Date.now()}`;
    const base = { room: "고도화운영테스트방", sender: "영주 관리자", json: { chat_id: roomId, user_id: operatorExternalId } };
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { ...base, msg: "/영주수익순위", json: { ...base.json, _id: readId } } });
    await waitForReply(replies, 1);
    assert.equal(replies.at(-1)?.data.includes("11위 영주회원11 - 👑: 1,000"), true);
    const resetId = `lord-reset-${Date.now()}`;
    const resetPayload = { ...base, msg: "/영주수익순위초기화", json: { ...base.json, _id: resetId } };
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: resetPayload });
    await waitForReply(replies, 2);
    assert.equal(replies.at(-1)?.data, "영주수익순위가 초기화되었습니다.");
    let state = (await database.query<Array<{ positive: bigint }>>("SELECT SUM(amount>0) AS positive FROM player_lord_earnings"))[0]!;
    assert.equal(Number(state.positive), 0);
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: resetPayload });
    const mutations = (await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM lord_income_reset_mutations"))[0]!;
    assert.equal(Number(mutations.count), 1);
    await database.execute("UPDATE player_lord_earnings SET amount=777 WHERE player_id=(SELECT player_id FROM player_profiles WHERE current_display_name='영주회원1')");
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='ADMIN_LORD_INCOME_RESET'");
    const shadowId = `lord-shadow-${Date.now()}`;
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { ...resetPayload, json: { ...base.json, _id: shadowId } } });
    state = (await database.query<Array<{ positive: bigint }>>("SELECT SUM(amount>0) AS positive FROM player_lord_earnings"))[0]!;
    assert.equal(Number(state.positive), 1);
    const route = (await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${shadowId}`]))[0]!;
    assert.equal(route.route, "SHADOW");
    await app.close();
  });
});
