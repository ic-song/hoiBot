import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { TierRosterReadService } from "../src/player/tier-roster-read-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("tier roster read MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "tier-roster-token", roomId = "990000000000411", externalUserId = "tier-roster-requester";
  let incompletePlayerId: bigint;

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code IN('TIER_ROSTER_READ','TIER_RANK_READ')");
    const tiers = await database.query<Array<{ tier_code: string; display_name: string }>>(
      "SELECT definition.tier_code,definition.display_name FROM tier_definition_publications publication JOIN tier_definitions definition ON definition.version_id=publication.version_id WHERE publication.publication_key='ACTIVE' AND definition.display_name IN('새싹','실버')"
    );
    const tier = (name: string) => tiers.find((row) => row.display_name === name)!.tier_code;
    const items = await database.query<Array<{ id: bigint; code: string }>>("SELECT id,code FROM item_definitions WHERE code IN('ITEM-RWD-022','tier_advanced_ticket')");
    const regular = items.find((row) => row.code === "ITEM-RWD-022")!.id;
    const advanced = items.find((row) => row.code === "tier_advanced_ticket")!.id;
    for (const [id, name, tierCode, regularCount, advancedCount] of [[externalUserId, "조회자", tier("새싹"), 300, 0], ["tier-rank-2", "고급회원", tier("실버"), 0, 1]] as const) {
      await database.execute("INSERT INTO players(status,version) VALUES('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,tier_code,version) VALUES (?,?,?,1)", [player.id, name, tierCode]);
      await database.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (?,'🌱',?)", [player.id, player.id]);
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, id, name]);
      if (regularCount > 0) await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1)", [player.id, regular, regularCount]);
      if (advancedCount > 0) await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1)", [player.id, advanced, advancedCount]);
    }
    await database.execute("INSERT INTO players(status,version) VALUES('disabled',1)");
    incompletePlayerId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!.id;
  });

  after(async () => {
    if (!database) return;
    try { await database.close(); } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("routes both reads, replays, shadows and fails closed without partial evidence", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "tier-roster-pepper", DATABASE_ENABLED: "true",
      DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"),
      DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = (eventId: string, msg: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg, room: "고도화티어방", sender: "조회자", json: { _id: eventId, chat_id: roomId, user_id: externalUserId } } });

    const rosterEvent = `tier-roster-${Date.now()}`;
    assert.equal((await send(rosterEvent, "/티어확인")).statusCode, 202);
    assert.match(replies.at(-1)!.data, /현재 티어 정보:[\s\S]*실버: 고급회원[\s\S]*새싹: 조회자/);
    const rankEvent = `tier-rank-${Date.now()}`;
    assert.equal((await send(rankEvent, "/티어순위")).statusCode, 202);
    assert.match(replies.at(-1)!.data, /🥇🌱조회자 - pt: 300[\s\S]*🥈🌱고급회원 - pt: 300/);
    const replay = await new TierRosterReadService(database).handle({ eventId: `iris:${rankEvent}`, externalUserId, channelId: roomId, message: "/티어순위" });
    assert.equal(replay?.command, "rank");
    assert.equal((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM operations WHERE idempotency_scope='player.tier_rank_read' AND idempotency_key=?", [`iris:${rankEvent}`]))[0]!.count_value, 1n);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='TIER_ROSTER_READ'");
    const shadow = `tier-roster-shadow-${Date.now()}`;
    await send(shadow, "/티어확인");
    assert.equal((await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${shadow}`]))[0]!.route, "SHADOW");

    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='TIER_ROSTER_READ'");
    await database.execute("UPDATE players SET status='active' WHERE id=?", [incompletePlayerId]);
    const failedEvent = `tier-roster-incomplete-${Date.now()}`;
    assert.equal((await send(failedEvent, "/티어확인")).statusCode, 202);
    assert.match(replies.at(-1)!.data, /이름·티어·랭크 데이터가 완전하지 않습니다/);
    assert.equal((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM operations WHERE idempotency_scope='player.tier_roster_read' AND idempotency_key=?", [failedEvent]))[0]!.count_value, 0n);
    assert.equal(await database.verifyRollback(), true);
    await app.close();
  });
});
