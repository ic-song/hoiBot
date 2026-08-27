import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string) => process.env[name] ?? "integration-not-configured";

describe("player overall rank MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "player-overall-rank-token";
  const externalUserId = "player-overall-rank-user";
  const open = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5000 });

  before(async () => {
    database = open();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='PLAYER_OVERALL_RANK_READ'");
    for (let index = 0; index < 7; index++) {
      await database.execute("INSERT INTO players(status,version) VALUES('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES(?,?,1)", [player.id, `종합회원${index + 1}`]);
      await database.execute("INSERT INTO player_pets(player_id,display_name,experience,enhancement_level,version) VALUES(?,?,?, ?,1)", [player.id, `펫${index + 1}`, 1000 - index * 10, 10 - index]);
      if (index === 0) await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES(?,'kakao',?,'종합회원1','linked')", [player.id, externalUserId]);
      if (index === 0) {
        const pet = (await database.query<Array<{ id: bigint }>>("SELECT id FROM player_pets WHERE player_id=?", [player.id]))[0]!;
        await database.execute("INSERT INTO skill_definitions(code,display_name,rules_json,active) VALUES('overall-rank-blue-dragon','청룡언월도',JSON_OBJECT(),TRUE)");
        const skill = (await database.query<Array<{ id: bigint }>>("SELECT id FROM skill_definitions WHERE code='overall-rank-blue-dragon'"))[0]!;
        await database.execute("INSERT INTO pet_skills(player_pet_id,slot_no,skill_id,level,equipped) VALUES(?,1,?,1,TRUE)", [pet.id, skill.id]);
      }
    }
  });

  after(async () => { if (database) try { await database.close(); } catch {} });

  it("ranks, replays, rolls back, shadows and reconnects", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "player-overall-rank-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const dependencies = { database, inspectIrisChannel: async () => ({ mode: "operational" as const, channelClass: "open_group" as const, reason: "allowed" as const, evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply: { room: string; data: string }) => { replies.push(reply); } };
    let app = buildApp(config, dependencies);
    let send = (id: string, msg: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg, room: "고도화종합순위방", sender: "종합회원1", json: { _id: id, chat_id: "990000000000231", user_id: externalUserId } } });
    const eventId = `overall-rank-${Date.now()}`;
    const firstResponse = await send(eventId, "/종합순위");
    assert.equal(firstResponse.statusCode, 202, firstResponse.body);
    assert.match(replies.at(-1)!.data, /👑 종합 순위 👑/);
    assert.match(replies.at(-1)!.data, /종합회원1/);
    assert.match(replies.at(-1)!.data, /뒤를 조심하세요/);
    assert.equal((replies.at(-1)!.data.match(/\u200b/g) ?? []).length, 500);
    await send(eventId, "/종합순위");
    assert.equal(Number((await database.query<Array<{ n: bigint }>>("SELECT COUNT(*) n FROM command_executions WHERE command_code='PLAYER_OVERALL_RANK_READ'"))[0]!.n), 1);
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='PLAYER_OVERALL_RANK_READ'");
    const beforeShadow = replies.length;
    await send(`shadow-${Date.now()}`, "ㅈㅈㅈ");
    assert.equal(replies.length, beforeShadow);
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='PLAYER_OVERALL_RANK_READ'");
    await database.execute("CREATE TRIGGER synthetic_overall_rank_audit_failure BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fail'");
    assert.equal((await send(`fail-${Date.now()}`, "/종합순위")).statusCode, 500);
    await database.execute("DROP TRIGGER synthetic_overall_rank_audit_failure");
    await app.close();
    database = open();
    app = buildApp(config, { ...dependencies, database });
    send = (id, msg) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg, room: "고도화종합순위방", sender: "종합회원1", json: { _id: id, chat_id: "990000000000231", user_id: externalUserId } } });
    assert.equal((await send(`reconnect-${Date.now()}`, "ㅈㅈㅈ")).statusCode, 202);
    await app.close();
  });
});
