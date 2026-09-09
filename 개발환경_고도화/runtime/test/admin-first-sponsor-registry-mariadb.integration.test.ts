import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("first sponsor registry MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "first-sponsor-iris-token";
  const roomId = "990000000000254";
  const operatorExternalId = "first-sponsor-operator";
  const firstName = "가 합성후원자";
  const secondName = "나 합성후원자";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE handler_key='admin_first_sponsor_registry'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES ('first-sponsor-op','첫후원 관리자','synthetic','active')");
    await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES ('first-sponsor-role','첫후원 역할',1)");
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id='first-sponsor-op'"))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='first-sponsor-role'"))[0]!;
    await database.execute("INSERT INTO admin_role_permissions(role_id,permission_code) VALUES (?,'game.event.change')", [role.id]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const operatorPlayer = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'첫후원 관리자','linked')", [operatorPlayer.id, operatorExternalId]);
    const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [operatorExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
    for (const name of [secondName, firstName]) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [player.id, name]);
    }
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

  it("registers, lists, replays and releases without duplicate mutation", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "first-sponsor-pepper",
      PARTIAL_COMMAND_DISPATCH_ENABLED: "true", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
      DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (eventId: string, msg: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg, room: "고도화팻테스트방", sender: "첫후원 관리자", json: { _id: eventId, chat_id: roomId, user_id: operatorExternalId } } });
    const registerFirst = `first-sponsor-register-first-${Date.now()}`;
    assert.equal((await send(registerFirst, `/첫후원 ${firstName}`)).statusCode, 202);
    await send(registerFirst, `/첫후원 ${firstName}`);
    assert.equal((await send(`first-sponsor-register-second-${Date.now()}`, `/첫후원 ${secondName}`)).statusCode, 202);
    assert.equal((await send(`first-sponsor-list-${Date.now()}`, "/첫후원리스트")).statusCode, 202);
    assert.equal(replies.at(-1)?.data, `첫후원 회원 목록\n${firstName}\n${secondName}`);
    assert.equal((await send(`first-sponsor-release-${Date.now()}`, `/첫후원해제 ${firstName}`)).statusCode, 202);
    const flags = await database.query<Array<{ current_display_name: string; first_sponsor: number }>>(
      "SELECT profile.current_display_name,flag.first_sponsor FROM player_sponsor_flags flag JOIN player_profiles profile ON profile.player_id=flag.player_id ORDER BY profile.current_display_name"
    );
    assert.deepEqual(flags.map((row) => [row.current_display_name, row.first_sponsor]), [[firstName, 0], [secondName, 1]]);
    const events = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM player_sponsor_flag_events");
    assert.equal(Number(events[0]!.count), 3);
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='ADMIN_FIRST_SPONSOR_REGISTER'");
    await send(`first-sponsor-shadow-${Date.now()}`, `/첫후원 ${firstName}`);
    const shadowFlag = (await database.query<Array<{ first_sponsor: number }>>("SELECT flag.first_sponsor FROM player_sponsor_flags flag JOIN player_profiles profile ON profile.player_id=flag.player_id WHERE profile.current_display_name=?", [firstName]))[0]!;
    assert.equal(shadowFlag.first_sponsor, 0);

    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='ADMIN_FIRST_SPONSOR_REGISTER'");
    await database.execute("CREATE TRIGGER fail_first_sponsor_event BEFORE INSERT ON player_sponsor_flag_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic rollback'");
    const rollbackEventId = `first-sponsor-rollback-${Date.now()}`;
    const rollbackResponse = await send(rollbackEventId, `/첫후원 ${firstName}`);
    assert.equal(rollbackResponse.statusCode, 500);
    await database.execute("DROP TRIGGER fail_first_sponsor_event");
    const rollbackFlag = (await database.query<Array<{ first_sponsor: number }>>("SELECT flag.first_sponsor FROM player_sponsor_flags flag JOIN player_profiles profile ON profile.player_id=flag.player_id WHERE profile.current_display_name=?", [firstName]))[0]!;
    assert.equal(rollbackFlag.first_sponsor, 0);
    const rolledBackOperation = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM operations WHERE idempotency_key=?", [`iris:${rollbackEventId}`]);
    assert.equal(Number(rolledBackOperation[0]!.count), 0);
    await app.close();
  });
});
