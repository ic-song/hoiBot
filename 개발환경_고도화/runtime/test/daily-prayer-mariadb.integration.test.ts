import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("daily prayer MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "daily-prayer-iris-token";
  const roomId = "990000000000265";
  const externalUserId = "daily-prayer-player";
  let playerId = "";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='PLAYER_DAILY_PRAYER'");
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    playerId = player.id.toString();
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'합성 기도회원','linked')", [player.id, externalUserId]);
    await database.execute("INSERT INTO player_pets(player_id,display_name,version) VALUES (?,'합성 기도펫',1)", [player.id]);
    const pet = (await database.query<Array<{ id: bigint }>>("SELECT id FROM player_pets WHERE player_id=?", [player.id]))[0]!;
    const skill = (await database.query<Array<{ id: bigint }>>("SELECT id FROM skill_definitions WHERE code='SKILL-PRAYER'"))[0]!;
    await database.execute("INSERT INTO pet_skills(player_pet_id,slot_no,skill_id,level,equipped) VALUES (?,1,?,1,TRUE)", [pet.id, skill.id]);
    await database.execute("UPDATE item_definitions SET active=TRUE,stackable=TRUE WHERE code='ITEM-RWD-048'");
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

  it("commits one KST-period reward and leaves Shadow mutation-free", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "daily-prayer-pepper",
      DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
      DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, dailyPrayerRandom: () => 0.029999,
      inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
        evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }),
      sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const eventId = `daily-prayer-${Date.now()}`;
    const payload = { msg: "/기도", room: "고도화팻테스트방", sender: "합성 기도회원",
      json: { _id: eventId, chat_id: roomId, user_id: externalUserId } };
    const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload });
    assert.equal(response.statusCode, 202, response.body);
    assert.equal(replies.at(-1)?.data, "🙏 기도가 이루어졌습니다.\n주간상자🌼 1개를 획득했습니다.");
    const counter = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM player_counters WHERE player_id=? AND counter_code='daily_prayer_used'", [playerId]);
    const rng = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM rng_events WHERE player_id=? AND outcome_code='reward'", [playerId]);
    const ledger = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM inventory_ledger WHERE player_id=? AND reason_code='daily_prayer_reward'", [playerId]);
    assert.deepEqual([Number(counter[0]!.count), Number(rng[0]!.count), Number(ledger[0]!.count)], [1, 1, 1]);

    const second = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { ...payload, json: { ...payload.json, _id: `${eventId}-second` } } });
    assert.equal(second.statusCode, 202, second.body);
    assert.equal(replies.length, 1);
    const afterSecond = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM rng_events WHERE player_id=?", [playerId]);
    assert.equal(Number(afterSecond[0]!.count), 1);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='PLAYER_DAILY_PRAYER'");
    const shadowEventId = `${eventId}-shadow`;
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { ...payload, json: { ...payload.json, _id: shadowEventId } } });
    const route = (await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${shadowEventId}`]))[0]!;
    assert.equal(route.route, "SHADOW");
    const afterShadow = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM rng_events WHERE player_id=?", [playerId]);
    assert.equal(Number(afterShadow[0]!.count), 1);
    await app.close();
  });
});
