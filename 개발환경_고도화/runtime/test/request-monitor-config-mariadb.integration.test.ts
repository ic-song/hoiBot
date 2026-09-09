import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

// Iris 이벤트 처리 뒤 응답 완료를 제한 시간 안에서 기다립니다.
async function waitForReply(replies: Array<{ room: string; data: string }>, count: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (replies.length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(replies.length >= count, true, "Iris reply was not delivered within 5 seconds");
}

describe("request monitor config MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const suffix = Date.now().toString();
  const token = "request-monitor-config-token";
  const roomId = "990000000000441";
  const operatorExternalId = `request-config-admin-${suffix}`;

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='ADMIN_REQUEST_MONITOR_CONFIG'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,?,'active')", [`request-config-${suffix}`, "요청 설정 관리자", "synthetic"]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`request-config-${suffix}`]))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='super_admin'"))[0]!;
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'요청 설정 관리자','linked')", [player.id, operatorExternalId]);
    const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [operatorExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
  });

  after(async () => { if (database) { try { await database.close(); } catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; } } });

  it("reads, updates once and keeps Shadow mutation-free", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "request-config-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (id: string, message: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화요청설정방", sender: "요청 설정 관리자", json: { _id: id, chat_id: roomId, user_id: operatorExternalId } } });
    await send(`request-config-read-${Date.now()}`, "/요청설정");
    await waitForReply(replies, 1);
    assert.match(replies.at(-1)!.data, /감지 시간: 2초\n감지 횟수: 4회$/);
    const updateId = `request-config-update-${Date.now()}`;
    await send(updateId, "/요청설정 1.5 2.9");
    await waitForReply(replies, 2);
    assert.match(replies.at(-1)!.data, /감지 시간: 1.5초\n감지 횟수: 2회$/);
    let state = (await database.query<Array<{ window_ms: bigint; limit_count: bigint; version: bigint }>>("SELECT window_ms,limit_count,version FROM request_monitor_config WHERE id=1"))[0]!;
    assert.deepEqual([Number(state.window_ms), Number(state.limit_count), Number(state.version)], [1500, 2, 2]);
    await send(updateId, "/요청설정 1.5 2.9");
    const mutations = (await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM request_monitor_config_mutations"))[0]!;
    assert.equal(Number(mutations.count), 1);
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='ADMIN_REQUEST_MONITOR_CONFIG'");
    const shadowId = `request-config-shadow-${Date.now()}`;
    await send(shadowId, "/요청설정 9 9");
    state = (await database.query<Array<{ window_ms: bigint; limit_count: bigint; version: bigint }>>("SELECT window_ms,limit_count,version FROM request_monitor_config WHERE id=1"))[0]!;
    assert.deepEqual([Number(state.window_ms), Number(state.limit_count), Number(state.version)], [1500, 2, 2]);
    const route = (await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${shadowId}`]))[0]!;
    assert.equal(route.route, "SHADOW");
    await app.close();
  });
});
