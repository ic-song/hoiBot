import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

async function waitForReply(replies: Array<{ room: string; data: string }>, count: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (replies.length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(replies.length >= count, true, "Iris reply was not delivered within 5 seconds");
}

describe("operation interval reset MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const suffix = Date.now().toString();
  const token = "operation-interval-reset-token";
  const scopedRoomId = "990000000000446";
  const otherRoomId = "990000000000447";
  const superExternalId = `interval-super-${suffix}`;
  const managerExternalId = `interval-manager-${suffix}`;

  async function createOperator(roleCode: "super_admin" | "manager", externalId: string): Promise<void> {
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,?,'active')", [`interval-${roleCode}-${suffix}`, `주기 ${roleCode}`, "synthetic"]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`interval-${roleCode}-${suffix}`]))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code=?", [roleCode]))[0]!;
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, externalId, `주기 ${roleCode}`]);
    const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [externalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
  }

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='ADMIN_OPERATION_INTERVAL_RESET'");
    await createOperator("super_admin", superExternalId);
    await createOperator("manager", managerExternalId);
    await database.execute("INSERT INTO operation_interval_room_scopes(provider_code,destination_id,display_name,active) VALUES ('iris',?,'호이월드 GM 관리자방',TRUE)", [scopedRoomId]);
    await database.execute("UPDATE operation_interval_control SET cancellation_generation=40,active_interval_count=2,previous_interval_marker=1724630400000,version=7 WHERE control_code='legacy_exploration'");
  });

  after(async () => { if (database) { try { await database.close(); } catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; } } });

  it("resets as super admin, scopes managers, replays safely and keeps Shadow mutation-free", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "operation-interval-reset-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (id: string, roomId: string, externalId: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: "/주기리셋", room: "합성 관리자방", sender: externalId, json: { _id: id, chat_id: roomId, user_id: externalId } } });
    const superEvent = `interval-super-${Date.now()}`;
    await send(superEvent, otherRoomId, superExternalId);
    await waitForReply(replies, 1);
    assert.equal(replies.at(-1)!.data, "주기리셋완");
    await send(superEvent, otherRoomId, superExternalId);
    await send(`interval-manager-denied-${Date.now()}`, otherRoomId, managerExternalId);
    await waitForReply(replies, 2);
    assert.equal(replies.at(-1)!.data, "주기리셋은 지정된 관리자방에서만 실행할 수 있습니다.");
    await send(`interval-manager-${Date.now()}`, scopedRoomId, managerExternalId);
    await waitForReply(replies, 3);
    assert.equal(replies.at(-1)!.data, "주기리셋완");
    let state = (await database.query<Array<{ generation: string; active_count: number; marker: string; version: string }>>(
      "SELECT CAST(cancellation_generation AS CHAR) generation,active_interval_count active_count,CAST(previous_interval_marker AS CHAR) marker,CAST(version AS CHAR) version FROM operation_interval_control WHERE control_code='legacy_exploration'"
    ))[0]!;
    assert.deepEqual([state.generation, Number(state.active_count), state.marker, state.version], ["42", 0, "0", "9"]);
    const mutations = (await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM operation_interval_reset_mutations"))[0]!;
    assert.equal(Number(mutations.count), 2);
    await database.execute("UPDATE operation_interval_control SET active_interval_count=3,previous_interval_marker=999 WHERE control_code='legacy_exploration'");
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='ADMIN_OPERATION_INTERVAL_RESET'");
    const shadowId = `interval-shadow-${Date.now()}`;
    await send(shadowId, otherRoomId, superExternalId);
    state = (await database.query<Array<{ generation: string; active_count: number; marker: string; version: string }>>(
      "SELECT CAST(cancellation_generation AS CHAR) generation,active_interval_count active_count,CAST(previous_interval_marker AS CHAR) marker,CAST(version AS CHAR) version FROM operation_interval_control WHERE control_code='legacy_exploration'"
    ))[0]!;
    assert.deepEqual([state.generation, Number(state.active_count), state.marker, state.version], ["42", 3, "999", "9"]);
    const route = (await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${shadowId}`]))[0]!;
    assert.equal(route.route, "SHADOW");
    await app.close();
  });
});
