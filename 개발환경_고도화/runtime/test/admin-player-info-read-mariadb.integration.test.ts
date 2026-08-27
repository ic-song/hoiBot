import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string) => process.env[name] ?? "integration-not-configured";

describe("admin player info read MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "admin-player-info-token";
  const operatorExternalId = "admin-player-info-operator";
  const open = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5000 });

  before(async () => {
    database = open();
    await database.execute("UPDATE command_registry SET rollout_state = 'ACTIVE' WHERE command_code = 'ADMIN_PLAYER_INFO_READ'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES('api-info-op','정보 관리자','x','active')");
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id = 'api-info-op'"))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code = 'manager'"))[0]!;
    await database.execute("INSERT INTO admin_operator_roles VALUES(?,?)", [operator.id, role.id]);

    await database.execute("INSERT INTO players(status,version) VALUES('active',1)");
    const actor = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'정보 관리자',1)", [actor.id]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES(?,'kakao',?,'정보 관리자','linked')", [actor.id, operatorExternalId]);
    const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE external_user_id = ?", [operatorExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES(?,?)", [operator.id, identity.id]);

    await database.execute("INSERT INTO players(status,version) VALUES('active',1)");
    const target = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,level,experience,accumulated_level_offset,version) VALUES (?,'대상회원',3,12,2,1)", [target.id]);
    await database.execute("INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES('admin_info_test_box','테스트상자','item',TRUE,JSON_OBJECT('legacyBagOrder',1),TRUE,1)");
    const item = (await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code = 'admin_info_test_box'"))[0]!;
    await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES(?,?,3,1)", [target.id, item.id]);
    await database.execute("INSERT INTO title_definitions(code,display_name,scope_code,active) VALUES('admin_info_hero','용사','player',TRUE)");
    const title = (await database.query<Array<{ id: bigint }>>("SELECT id FROM title_definitions WHERE code = 'admin_info_hero'"))[0]!;
    await database.execute("INSERT INTO player_titles(player_id,title_id,acquired_at,equipped) VALUES(?,?,UTC_TIMESTAMP(3),TRUE)", [target.id, title.id]);
    await database.execute("INSERT INTO attendance_programs(code,display_name,reset_policy_code,active) VALUES('admin_info_daily','정보 출석','daily',TRUE)");
    const program = (await database.query<Array<{ id: bigint }>>("SELECT id FROM attendance_programs WHERE code = 'admin_info_daily'"))[0]!;
    await database.execute("INSERT INTO player_attendance(player_id,program_id,period_key,attendance_count,last_attended_at,version) VALUES(?,?,'2026-08-27',1,UTC_TIMESTAMP(3),1)", [target.id, program.id]);
    await database.execute("INSERT INTO player_check_counts(player_id,check_count,version) VALUES(?,2,1)", [target.id]);
  });

  after(async () => { if (database) try { await database.close(); } catch {} });

  it("reads, replays, rolls back, shadows and reconnects", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "admin-player-info-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const dependencies = { database, inspectIrisChannel: async () => ({ mode: "operational" as const, channelClass: "open_group" as const, reason: "allowed" as const, evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply: { room: string; data: string }) => { replies.push(reply); } };
    let app = buildApp(config, dependencies);
    let send = (id: string, msg: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg, room: "고도화정보방", sender: "정보 관리자", json: { _id: id, chat_id: "990000000000230", user_id: operatorExternalId } } });
    const eventId = `admin-info-${Date.now()}`;
    assert.equal((await send(eventId, "/정보 대상회원")).statusCode, 202);
    assert.match(replies.at(-1)!.data, /대상회원/);
    assert.match(replies.at(-1)!.data, /테스트상자 x 3/);
    assert.match(replies.at(-1)!.data, /용사 ✔/);
    assert.match(replies.at(-1)!.data, /보룸인증: 2회/);
    await send(eventId, "/정보 대상회원");
    assert.equal(Number((await database.query<Array<{ n: bigint }>>("SELECT COUNT(*) n FROM command_executions WHERE command_code = 'ADMIN_PLAYER_INFO_READ'"))[0]!.n), 1);

    assert.equal((await send(`missing-${Date.now()}`, "/정보 없는회원")).statusCode, 202);
    assert.match(replies.at(-1)!.data, /등록되지 않은 유저/);
    await database.execute("UPDATE command_registry SET rollout_state = 'SHADOW' WHERE command_code = 'ADMIN_PLAYER_INFO_READ'");
    const beforeShadow = replies.length;
    await send(`shadow-${Date.now()}`, "/정보 대상회원");
    assert.equal(replies.length, beforeShadow);
    await database.execute("UPDATE command_registry SET rollout_state = 'ACTIVE' WHERE command_code = 'ADMIN_PLAYER_INFO_READ'");

    await database.execute("CREATE TRIGGER synthetic_admin_info_audit_failure BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fail'");
    assert.equal((await send(`fail-${Date.now()}`, "/정보 대상회원")).statusCode, 500);
    await database.execute("DROP TRIGGER synthetic_admin_info_audit_failure");
    await app.close();
    database = open();
    app = buildApp(config, { ...dependencies, database });
    send = (id, msg) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg, room: "고도화정보방", sender: "정보 관리자", json: { _id: id, chat_id: "990000000000230", user_id: operatorExternalId } } });
    assert.equal((await send(`reconnect-${Date.now()}`, "/정보 대상회원")).statusCode, 202);
    await app.close();
  });
});
