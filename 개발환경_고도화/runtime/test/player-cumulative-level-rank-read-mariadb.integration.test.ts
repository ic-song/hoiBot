import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("player cumulative level rank read MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "player-cumulative-level-rank-read-token";
  const roomId = "990000000000586";
  const suffix = Date.now().toString();
  const externalUserId = `cumulative-level-reader-${suffix}`;

  const connect = () => createDatabaseClient({
    enabled: true,
    host: required("DATABASE_HOST"),
    port: Number(required("DATABASE_PORT")),
    user: required("DATABASE_USER"),
    password: required("DATABASE_PASSWORD"),
    name: required("DATABASE_NAME"),
    connectionLimit: 5,
    connectTimeoutMs: 5_000
  });

  before(async () => {
    database = connect();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='PLAYER_CUMULATIVE_LEVEL_RANK_READ'");
    for (let index = 0; index < 12; index += 1) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      const displayName = index === 0 ? `누적왕-${suffix}` : `누적회원${String(index + 1).padStart(2, "0")}-${suffix}`;
      const level = index === 0 ? 9007199254740000n : BigInt(1200 - index);
      const offset = index === 0 ? 993n : BigInt(index * 100);
      await database.execute(
        "INSERT INTO player_profiles(player_id,current_display_name,level,accumulated_level_offset,version) VALUES (?,?,?,?,1)",
        [player.id, displayName, level, offset]
      );
      await database.execute(
        "INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (?,?,?)",
        [player.id, index === 0 ? "⭐" : "", index + 1]
      );
      if (index === 0) {
        await database.execute(
          "INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')",
          [player.id, externalUserId, displayName]
        );
      }
    }
    await database.execute("INSERT INTO players(status,version) VALUES ('suspended',1)");
    const excluded = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute(
      "INSERT INTO player_profiles(player_id,current_display_name,level,accumulated_level_offset,version) VALUES (?,'제외회원',999999999,999999999,1)",
      [excluded.id]
    );
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
  });

  after(async () => {
    delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
    if (!database) return;
    try {
      await database.execute("DROP TRIGGER IF EXISTS fail_cumulative_level_rank_audit");
      await database.close();
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("rolls back evidence, preserves level data, replays, blocks suffixes, shadows and survives reconnect", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({
      NODE_ENV: "test",
      IRIS_SHARED_TOKEN: token,
      USER_VERIFICATION_PEPPER: "player-cumulative-level-rank-read-pepper",
      DATABASE_ENABLED: "true",
      DATABASE_HOST: required("DATABASE_HOST"),
      DATABASE_PORT: required("DATABASE_PORT"),
      DATABASE_USER: required("DATABASE_USER"),
      DATABASE_PASSWORD: required("DATABASE_PASSWORD"),
      DATABASE_NAME: required("DATABASE_NAME")
    });
    let app = buildApp(config, {
      database,
      inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }),
      sendIrisTextReply: async (reply) => { replies.push(reply); }
    });
    const send = async (eventId: string, message = "/누렙순위", userId: string | null = externalUserId) => app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg: message, room: "고도화펫테스트방", sender: `누적왕-${suffix}`, json: { _id: eventId, chat_id: roomId, user_id: userId } }
    });
    const evidenceCounts = async () => {
      const operation = Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM operations WHERE idempotency_scope='player.cumulative_level_rank_read'"))[0]!.count_value);
      const audit = Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM command_audit WHERE action_code='player.cumulative_level_rank_read'"))[0]!.count_value);
      const execution = Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM command_executions WHERE command_code='PLAYER_CUMULATIVE_LEVEL_RANK_READ'"))[0]!.count_value);
      return { operation, audit, execution };
    };
    const levelState = async () => (await database.query<Array<{ count_value: bigint; level_sum: string; offset_sum: string }>>(
      "SELECT COUNT(*) count_value,CAST(SUM(level) AS CHAR) level_sum,CAST(SUM(accumulated_level_offset) AS CHAR) offset_sum FROM player_profiles"
    ))[0]!;
    const beforeLevels = await levelState();

    const unauthorizedReplies = replies.length;
    await send(`cumulative-level-unauthorized-${suffix}`, "/누렙순위", null);
    assert.equal(replies.length, unauthorizedReplies);
    assert.deepEqual(await evidenceCounts(), { operation: 0, audit: 0, execution: 0 });

    await database.execute("CREATE TRIGGER fail_cumulative_level_rank_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic cumulative level rank audit failure'");
    assert.equal((await send(`cumulative-level-rollback-${suffix}`)).statusCode, 500);
    await database.execute("DROP TRIGGER fail_cumulative_level_rank_audit");
    assert.deepEqual(await evidenceCounts(), { operation: 0, audit: 0, execution: 0 });

    const eventId = `cumulative-level-success-${suffix}`;
    const response = await send(eventId);
    assert.equal(response.statusCode, 202, response.body);
    const data = replies.at(-1)!.data;
    assert.match(data, new RegExp(`🥇⭐누적왕-${suffix} - LV\\.9007199254740993`));
    assert.equal(data.includes("제외회원"), false);
    assert.equal((data.match(/\u200b/g) ?? []).length, 500);
    assert.match(data, /11위 /);
    assert.match(data, /12위 /);
    assert.deepEqual(await evidenceCounts(), { operation: 1, audit: 1, execution: 1 });
    assert.deepEqual(await levelState(), beforeLevels);

    await send(eventId);
    assert.deepEqual(await evidenceCounts(), { operation: 1, audit: 1, execution: 1 });
    const replyCount = replies.length;
    await send(`cumulative-level-suffix-${suffix}`, "/누렙순위 1");
    assert.equal(replies.length, replyCount);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='PLAYER_CUMULATIVE_LEVEL_RANK_READ'");
    await send(`cumulative-level-shadow-${suffix}`);
    assert.deepEqual(await evidenceCounts(), { operation: 1, audit: 1, execution: 1 });
    assert.deepEqual(await levelState(), beforeLevels);

    const beforeReconnect = await evidenceCounts();
    await app.close();
    database = connect();
    assert.deepEqual(await evidenceCounts(), beforeReconnect);
    assert.deepEqual(await levelState(), beforeLevels);
    app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }) });
    await app.close();
  });
});
