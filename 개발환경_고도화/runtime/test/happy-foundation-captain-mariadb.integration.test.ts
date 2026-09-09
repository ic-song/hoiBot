import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("happy foundation captain MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "happy-foundation-token";
  const roomId = "990000000000255";
  const operatorExternalId = "happy-foundation-operator";
  const targetName = "합성 행복단장";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='HAPPY_FOUNDATION_CAPTAIN_CHANGE'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES ('happy-foundation-op','행복재단 관리자','synthetic','active')");
    await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES ('happy-foundation-role','행복재단 역할',1)");
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id='happy-foundation-op'"))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='happy-foundation-role'"))[0]!;
    await database.execute("INSERT INTO admin_role_permissions(role_id,permission_code) VALUES (?,'game.event.change')", [role.id]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const operatorPlayer = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'행복재단 관리자','linked')", [operatorPlayer.id, operatorExternalId]);
    const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [operatorExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const target = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [target.id, targetName]);
    await database.execute("UPDATE foundation_states SET total_amount=500 WHERE foundation_code='happy'");
  });

  after(async () => {
    if (!database) return;
    try { await database.close(); } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("sets, resets, clears, replays, shadows and rolls back atomically", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "happy-foundation-pepper", PARTIAL_COMMAND_DISPATCH_ENABLED: "true",
      DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (eventId: string, msg: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg, room: "고도화팻테스트방", sender: "행복재단 관리자", json: { _id: eventId, chat_id: roomId, user_id: operatorExternalId } } });
    const firstEvent = `happy-foundation-set-${Date.now()}`;
    assert.equal((await send(firstEvent, `/행복단장변경 ${targetName}`)).statusCode, 202);
    await send(firstEvent, `/행복단장변경 ${targetName}`);
    let state = (await database.query<Array<{ captain_player_id: bigint | null; total_amount: string; version: bigint }>>("SELECT captain_player_id,CAST(total_amount AS CHAR) AS total_amount,version FROM foundation_states WHERE foundation_code='happy'"))[0]!;
    assert.notEqual(state.captain_player_id, null); assert.equal(state.total_amount, "0.000"); assert.equal(state.version, 2n);
    await database.execute("UPDATE foundation_states SET total_amount=900 WHERE foundation_code='happy'");
    assert.equal((await send(`happy-foundation-same-${Date.now()}`, `/행복단장변경 ${targetName}`)).statusCode, 202);
    state = (await database.query<Array<{ captain_player_id: bigint | null; total_amount: string; version: bigint }>>("SELECT captain_player_id,CAST(total_amount AS CHAR) AS total_amount,version FROM foundation_states WHERE foundation_code='happy'"))[0]!;
    assert.equal(state.total_amount, "0.000"); assert.equal(state.version, 3n);
    assert.equal((await send(`happy-foundation-clear-${Date.now()}`, "/행복단장변경 해제")).statusCode, 202);
    state = (await database.query<Array<{ captain_player_id: bigint | null; total_amount: string; version: bigint }>>("SELECT captain_player_id,CAST(total_amount AS CHAR) AS total_amount,version FROM foundation_states WHERE foundation_code='happy'"))[0]!;
    assert.equal(state.captain_player_id, null); assert.equal(state.version, 4n);
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='HAPPY_FOUNDATION_CAPTAIN_CHANGE'");
    await send(`happy-foundation-shadow-${Date.now()}`, `/행복단장변경 ${targetName}`);
    state = (await database.query<Array<{ captain_player_id: bigint | null; total_amount: string; version: bigint }>>("SELECT captain_player_id,CAST(total_amount AS CHAR) AS total_amount,version FROM foundation_states WHERE foundation_code='happy'"))[0]!;
    assert.equal(state.captain_player_id, null); assert.equal(state.version, 4n);
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='HAPPY_FOUNDATION_CAPTAIN_CHANGE'");
    await database.execute("UPDATE foundation_states SET total_amount=111 WHERE foundation_code='happy'");
    await database.execute("CREATE TRIGGER fail_happy_foundation_log BEFORE INSERT ON configuration_change_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic rollback'");
    const rollbackEvent = `happy-foundation-rollback-${Date.now()}`;
    assert.equal((await send(rollbackEvent, `/행복단장변경 ${targetName}`)).statusCode, 500);
    await database.execute("DROP TRIGGER fail_happy_foundation_log");
    state = (await database.query<Array<{ captain_player_id: bigint | null; total_amount: string; version: bigint }>>("SELECT captain_player_id,CAST(total_amount AS CHAR) AS total_amount,version FROM foundation_states WHERE foundation_code='happy'"))[0]!;
    assert.equal(state.captain_player_id, null); assert.equal(state.total_amount, "111.000"); assert.equal(state.version, 4n);
    const rollbackOps = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM operations WHERE idempotency_key=?", [`iris:${rollbackEvent}`]);
    assert.equal(Number(rollbackOps[0]!.count), 0);
    const logs = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM configuration_change_log WHERE action_code='foundation.captain.change'");
    assert.equal(Number(logs[0]!.count), 3);
    assert.match(replies[0]?.data ?? "", /누적액이 0으로 초기화/);
    await app.close();
  });
});
