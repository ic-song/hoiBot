import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("mini pet experience rank MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "mini-pet-exp-rank-token";
  const roomId = "990000000000267";
  const externalUserId = "mini-pet-rank-viewer";
  const playerIds: string[] = [];

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"),
      connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='MINIPET_EXP_RANK_READ'");
    await database.execute("INSERT INTO mini_pet_definitions(code,display_name,active) VALUES ('rank-fixture','순위 미니펫',TRUE) ON DUPLICATE KEY UPDATE active=TRUE");
    const definition = (await database.query<Array<{ id: bigint }>>("SELECT id FROM mini_pet_definitions WHERE code='rank-fixture'"))[0]!;
    for (const [index, name] of ["가람", "나래", "다온"].entries()) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      playerIds.push(player.id.toString());
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [player.id, name]);
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?, 'linked')",
        [player.id, index === 0 ? externalUserId : `mini-pet-rank-${index}`, name]);
      await database.execute("INSERT INTO owned_mini_pets(player_id,mini_pet_definition_id,battle_experience,equipped) VALUES (?,?,?,TRUE)",
        [player.id, definition.id, index === 0 ? 100 : index === 1 ? 350 : 0]);
    }
    const first = playerIds[0]!;
    for (const experience of [70, 60, 50, 40, 30, 999]) {
      await database.execute("INSERT INTO owned_mini_pets(player_id,mini_pet_definition_id,battle_experience,equipped) VALUES (?,?,?,FALSE)",
        [first, definition.id, experience]);
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

  it("routes the command, persists a restart-safe snapshot, and leaves bag rows unchanged", async () => {
    const beforeRows = await database.query<Array<{ id: bigint; battle_experience: bigint; equipped: number }>>(
      "SELECT id,battle_experience,equipped FROM owned_mini_pets WHERE player_id=? ORDER BY id", [playerIds[0]!]
    );
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "mini-rank-pepper",
      DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
      DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, {
      database,
      inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
        evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }),
      sendIrisTextReply: async (reply) => { replies.push(reply); }
    });
    const providerEventId = `mini-pet-rank-${Date.now()}`;
    const payload = { msg: "/미니펫종합순위", room: "고도화팻테스트방", sender: "가람",
      json: { _id: providerEventId, chat_id: roomId, user_id: externalUserId } };
    const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload });
    assert.equal(response.statusCode, 202, response.body);
    assert.match(replies.at(-1)?.data ?? "", /1위 가람 \(\+1,319💕\)/);
    assert.match(replies.at(-1)?.data ?? "", /2위 나래 \(\+350💕\)/);
    const entries = await database.query<Array<{ player_id: bigint; rank_no: bigint; score: string }>>(
      `SELECT entry.player_id,entry.rank_no,entry.score FROM leaderboard_entries entry
       JOIN leaderboards board ON board.id=entry.leaderboard_id
       WHERE board.code='minipet_exp_total' AND board.season_key='lifetime' ORDER BY entry.rank_no`
    );
    assert.deepEqual(entries.map((entry) => [entry.player_id.toString(), Number(entry.rank_no), Number(entry.score)]), [
      [playerIds[0], 1, 1319], [playerIds[1], 2, 350]
    ]);
    const afterRows = await database.query<Array<{ id: bigint; battle_experience: bigint; equipped: number }>>(
      "SELECT id,battle_experience,equipped FROM owned_mini_pets WHERE player_id=? ORDER BY id", [playerIds[0]!]
    );
    assert.deepEqual(afterRows, beforeRows);
    const replay = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload });
    assert.equal(replay.statusCode, 202, replay.body);
    assert.equal(replies.length, 1);
    await app.close();
  });
});
