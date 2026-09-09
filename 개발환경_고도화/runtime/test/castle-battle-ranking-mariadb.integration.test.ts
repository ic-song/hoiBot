import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("castle battle ranking MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "castle-ranking-token";
  const roomId = "990000000000334";
  const fixtureKey = Date.now().toString();
  const externalId = `castle-ranking-reader-${fixtureKey}`;
  const seasonKey = `CASTLE-SYNTHETIC-${fixtureKey}`;

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='CASTLE_BATTLE_RANKING_READ'");
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,experience,version) VALUES (?,'순위조회자',0,1)", [player.id]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'순위조회자','linked')", [player.id, externalId]);
    await database.execute("INSERT INTO castle_battle_seasons(season_key,status,starts_at,version) VALUES (?,'active',UTC_TIMESTAMP(3),1)", [seasonKey]);
    const season = (await database.query<Array<{ id: bigint }>>("SELECT id FROM castle_battle_seasons WHERE season_key=?", [seasonKey]))[0]!;
    await database.execute("INSERT INTO castle_battle_rank_snapshots(season_id,snapshot_version,source_version,status,snapshot_at,published_at) VALUES (?,1,'fixture-v1','published',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [season.id]);
    const snapshot = (await database.query<Array<{ id: bigint }>>("SELECT id FROM castle_battle_rank_snapshots WHERE season_id=? AND snapshot_version=1", [season.id]))[0]!;
    for (const entry of [
      ["tie-b", "동점나중", 2, "왕", 100, "2026-08-25 02:00:00.000"],
      ["tie-a", "동점먼저", 1, "황제", 100, "2026-08-25 02:00:00.000"],
      ["third", "셋째", 3, "기사", 50, "2026-08-24 02:00:00.000"],
      ["fourth", "넷째", 4, "병사", 10, "2026-08-23 02:00:00.000"]
    ] as const) {
      await database.execute("INSERT INTO castle_battle_rank_snapshot_entries(snapshot_id,stable_tie_key,display_name,rank_display,tier_display,score,last_battle_at) VALUES (?,?,?,?,?,?,?)", [snapshot.id, ...entry]);
    }
  });

  after(async () => {
    if (!database) return;
    try {
      await database.close();
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("routes exact command, replays one outbox, orders ties and rolls back failed evidence", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "castle-ranking-pepper", PARTIAL_COMMAND_DISPATCH_ENABLED: "true", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = (eventId: string, msg: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg, room: "고도화팻테스트방", sender: externalId, json: { _id: eventId, chat_id: roomId, user_id: externalId } } });
    const eventId = `castle-ranking-${Date.now()}`;
    assert.equal((await send(eventId, "/캐슬대전순위")).statusCode, 202);
    assert.equal((await send(eventId, "/캐슬대전순위")).statusCode, 202);
    const operationCount = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM operations WHERE idempotency_scope LIKE 'castle-battle-ranking:%' AND idempotency_key=?", [`iris:${eventId}`]);
    assert.equal(Number(operationCount[0]!.count), 1);
    assert.ok((replies[0]?.data ?? "").indexOf("동점먼저") < (replies[0]?.data ?? "").indexOf("동점나중"));
    assert.match(replies[0]?.data ?? "", /\[4\] 넷째/);

    await database.execute("CREATE TRIGGER fail_castle_ranking_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic rollback'");
    const rollbackEvent = `castle-ranking-rollback-${Date.now()}`;
    assert.equal((await send(rollbackEvent, "/캐슬대전순위")).statusCode, 500);
    await database.execute("DROP TRIGGER fail_castle_ranking_audit");
    const rollbackCount = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM operations WHERE idempotency_scope LIKE 'castle-battle-ranking:%' AND idempotency_key=?", [`iris:${rollbackEvent}`]);
    assert.equal(Number(rollbackCount[0]!.count), 0);
    await app.close();
  });
});
