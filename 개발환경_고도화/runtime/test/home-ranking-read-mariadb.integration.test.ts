import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("home ranking read MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "home-ranking-read-token";
  const roomId = "990000000000581";
  const suffix = Date.now().toString();
  const externalUserId = `home-ranking-reader-${suffix}`;

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
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='HOME_RANKING_READ'");
    for (let index = 0; index < 12; index += 1) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      const ownerName = index === 0 ? `가나다-${suffix}` : index === 1 ? `나다라-${suffix}` : `회원${String(index + 1).padStart(2, "0")}-${suffix}`;
      const floorArea = index < 2 ? 120 : 120 - index;
      const experience = index === 0 ? 9007199254740993n : BigInt(100 + index);
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [player.id, ownerName]);
      await database.execute("INSERT INTO player_homes(player_id,display_name,base_experience,floor_area,version) VALUES (?,?,?,?,1)", [player.id, `합성 집 ${index + 1}`, experience, floorArea]);
      if (index === 0) {
        await database.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (?,'⭐',?)", [player.id, player.id]);
        await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, externalUserId, ownerName]);
      }
    }
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
  });

  after(async () => {
    delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
    if (!database) return;
    try {
      await database.execute("DROP TRIGGER IF EXISTS fail_home_ranking_audit");
      await database.close();
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("rolls back evidence, preserves ordering and BIGINT parity, replays, shadows and survives reconnect", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({
      NODE_ENV: "test",
      IRIS_SHARED_TOKEN: token,
      USER_VERIFICATION_PEPPER: "home-ranking-read-pepper",
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
    const send = async (eventId: string, message = "/펫홈순위") => app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg: message, room: "고도화펫테스트방", sender: `가나다-${suffix}`, json: { _id: eventId, chat_id: roomId, user_id: externalUserId } }
    });
    const evidenceCounts = async () => {
      const operation = Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM operations WHERE idempotency_scope='home.ranking_read'"))[0]!.count_value);
      const audit = Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM command_audit WHERE action_code='home.ranking_read'"))[0]!.count_value);
      const execution = Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM command_executions WHERE command_code='HOME_RANKING_READ'"))[0]!.count_value);
      return { operation, audit, execution };
    };

    await database.execute("CREATE TRIGGER fail_home_ranking_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic home ranking audit failure'");
    assert.equal((await send(`home-ranking-rollback-${suffix}`)).statusCode, 500);
    await database.execute("DROP TRIGGER fail_home_ranking_audit");
    assert.deepEqual(await evidenceCounts(), { operation: 0, audit: 0, execution: 0 });

    const eventId = `home-ranking-success-${suffix}`;
    const response = await send(eventId);
    assert.equal(response.statusCode, 202, response.body);
    const data = replies.at(-1)!.data;
    assert.ok(data.indexOf(`[⭐가나다-${suffix}]`) < data.indexOf(`[나다라-${suffix}]`));
    assert.match(data, /\+9007199254740993💕/);
    assert.equal((data.match(/\u200b/g) ?? []).length, 500);
    assert.match(data, /12위/);
    assert.deepEqual(await evidenceCounts(), { operation: 1, audit: 1, execution: 1 });

    await send(eventId);
    assert.deepEqual(await evidenceCounts(), { operation: 1, audit: 1, execution: 1 });
    const replyCount = replies.length;
    assert.equal((await send(`home-ranking-suffix-${suffix}`, "/펫홈순위 1")).statusCode, 202);
    assert.equal(replies.length, replyCount);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='HOME_RANKING_READ'");
    await send(`home-ranking-shadow-${suffix}`);
    assert.deepEqual(await evidenceCounts(), { operation: 1, audit: 1, execution: 1 });

    const beforeReconnect = await evidenceCounts();
    await app.close();
    database = connect();
    assert.deepEqual(await evidenceCounts(), beforeReconnect);
    app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }) });
    await app.close();
  });
});
