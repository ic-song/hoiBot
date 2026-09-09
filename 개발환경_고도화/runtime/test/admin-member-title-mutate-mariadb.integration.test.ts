import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string) => process.env[name] ?? "integration-not-configured";

describe("admin member title mutate MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "admin-title-mutate-token";
  const roomId = "990000000000313";
  const operatorExternalId = "admin-title-mutate-operator";
  const unauthorizedExternalId = "admin-title-mutate-user";
  const targetA = "타이틀대상가";
  const targetB = "타이틀대상나";
  const open = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5000 });

  before(async () => {
    database = open();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code IN('ADMIN_MEMBER_TITLE_ADD','ADMIN_MEMBER_TITLE_GRANT','ADMIN_MEMBER_TITLE_REMOVE')");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES('admin-title-mutate-op','타이틀 변경 관리자','synthetic','active')");
    await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES('admin-title-mutate-role','타이틀 변경 역할',1)");
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id='admin-title-mutate-op'"))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='admin-title-mutate-role'"))[0]!;
    await database.execute("INSERT INTO admin_role_permissions(role_id,permission_code) VALUES (?,'player.title.change')", [role.id]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    await database.execute("INSERT INTO players(id,status,version) VALUES(997313001,'active',1),(997313002,'active',1),(997313003,'active',1),(997313004,'active',1)");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES(997313001,?,1),(997313002,?,1)", [targetA, targetB]);
    await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES(997314001,997313003,'kakao',?,'타이틀 변경 관리자','linked'),(997314002,997313004,'kakao',?,'일반 회원','linked')", [operatorExternalId, unauthorizedExternalId]);
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,997314001)", [operator.id]);
  });

  after(async () => {
    if (database) try { await database.close(); } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ER_POOL_ALREADY_CLOSED")) throw error;
    }
  });

  it("dispatches three commands with stable duplicate instances, rollback and reconnect", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "admin-title-mutate-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const dependencies = { database, inspectIrisChannel: async () => ({ mode: "operational" as const, channelClass: "open_group" as const, reason: "allowed" as const, evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply: { room: string; data: string }) => { replies.push(reply); } };
    let app = buildApp(config, dependencies);
    let send = (id: string, user: string, message: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화팻테스트방", sender: "합성 관리자", json: { _id: id, chat_id: roomId, user_id: user } } });

    const firstEvent = `admin-title-add-${Date.now()}`;
    assert.equal((await send(firstEvent, operatorExternalId, `/타이틀추가 ${targetA}, 중복타이틀 000`)).statusCode, 202);
    await send(firstEvent, operatorExternalId, `/타이틀추가 ${targetA}, 중복타이틀 000`);
    assert.equal((await send(`admin-title-add-2-${Date.now()}`, operatorExternalId, `/타이틀추가 ${targetA}, 중복타이틀 000`)).statusCode, 202);
    let rows = await database.query<Array<{ legacy_price_json: string; status: string }>>("SELECT legacy_price_json,status FROM player_title_instances WHERE player_id=997313001 AND snapshot_name='중복타이틀' ORDER BY display_order");
    assert.deepEqual(rows, [{ legacy_price_json: '"000"', status: "owned" }, { legacy_price_json: '"000"', status: "owned" }]);

    assert.equal((await send(`admin-title-grant-${Date.now()}`, operatorExternalId, `/타이틀지급 ${targetA},${targetB},없는회원/공용타이틀/000000000000000000000000001`)).statusCode, 202);
    const numericJson = await database.query<Array<{ player_id: bigint; legacy_price_json: string }>>("SELECT player_id,legacy_price_json FROM player_title_instances WHERE snapshot_name='공용타이틀' ORDER BY player_id");
    assert.deepEqual(numericJson, [{ player_id: 997313001n, legacy_price_json: "1" }, { player_id: 997313002n, legacy_price_json: "1" }]);

    assert.equal((await send(`admin-title-remove-${Date.now()}`, operatorExternalId, `/타이틀제거 ${targetA} 2`)).statusCode, 202);
    rows = await database.query<Array<{ legacy_price_json: string; status: string }>>("SELECT legacy_price_json,status FROM player_title_instances WHERE player_id=997313001 AND snapshot_name='중복타이틀' ORDER BY display_order,id");
    assert.deepEqual(rows.map((row) => row.status).sort(), ["owned", "removed"]);

    const beforeUnauthorized = Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM player_title_instances"))[0]!.count_value);
    await send(`admin-title-unauthorized-${Date.now()}`, unauthorizedExternalId, `/타이틀추가 ${targetA}, 거부타이틀 1`);
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM player_title_instances"))[0]!.count_value), beforeUnauthorized);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='ADMIN_MEMBER_TITLE_ADD'");
    const beforeShadow = replies.length;
    await send(`admin-title-shadow-${Date.now()}`, operatorExternalId, `/타이틀추가 ${targetA}, 그림자타이틀 1`);
    assert.equal(replies.length, beforeShadow);
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='ADMIN_MEMBER_TITLE_ADD'");

    await database.execute("CREATE TRIGGER synthetic_admin_title_audit_failure BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='admin title audit failure'");
    assert.equal((await send(`admin-title-rollback-${Date.now()}`, operatorExternalId, `/타이틀추가 ${targetA}, 롤백타이틀 1`)).statusCode, 500);
    await database.execute("DROP TRIGGER synthetic_admin_title_audit_failure");
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM player_title_instances WHERE snapshot_name='롤백타이틀'"))[0]!.count_value), 0);
    assert.equal(await database.verifyRollback(), true);

    await app.close();
    database = open();
    app = buildApp(config, { ...dependencies, database });
    send = (id, user, message) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화팻테스트방", sender: "합성 관리자", json: { _id: id, chat_id: roomId, user_id: user } } });
    assert.equal((await send(`admin-title-reconnect-${Date.now()}`, operatorExternalId, `/타이틀추가 ${targetB}, 재연결타이틀 1`)).statusCode, 202);
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM player_title_instances WHERE player_id=997313002 AND snapshot_name='재연결타이틀' AND status='owned'"))[0]!.count_value), 1);
    await app.close();
  });
});
