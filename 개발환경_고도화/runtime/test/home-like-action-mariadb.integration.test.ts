import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { HomeLikeService } from "../src/home/home-like-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("home like action MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  let actorId: bigint;
  let targetId: bigint;
  const suffix = Date.now().toString();
  const token = "home-like-test-token";
  const room = "990000000000601";
  const actorExternal = `home-like-actor-${suffix}`;
  const adminExternal = `home-like-admin-${suffix}`;
  const actorName = `좋아홈 사용자 ${suffix}`;
  const targetName = `좋아홈 대상 ${suffix}`;
  const open = (): DatabaseClient => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
  const event = async (id: string, externalId: string): Promise<void> => { await database.execute("INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?,'iris',?,'message','test','incoming',REPEAT('8',64),'parsed','processing',UTC_TIMESTAMP(3))", [id, id]); };

  before(async () => {
    database = open();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code IN ('HOME_LIKE_MUTATE','HOME_LIKE_RANK_READ','HOME_LIKE_RESET')");
    for (const [externalId, displayName, pet] of [[actorExternal, actorName, false], [`home-like-target-${suffix}`, targetName, true]] as const) {
      const player = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [player.insertId, displayName]);
      await database.execute("INSERT INTO player_homes(player_id,display_name,version) VALUES (?,?,1)", [player.insertId, displayName]);
      await database.execute("INSERT INTO player_passes(player_id,pass_code,enabled,permanent) VALUES (?,'support',TRUE,TRUE)", [player.insertId]);
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.insertId, externalId, displayName]);
      if (pet) { targetId = player.insertId; await database.execute("INSERT INTO player_pets(player_id,display_name,version) VALUES (?,?,1)", [player.insertId, `좋아홈 펫 ${suffix}`]); }
      else actorId = player.insertId;
    }
    const operator = await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,?,'active')", [`home-like-admin-${suffix}`, "좋아홈 관리자", "synthetic"]);
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='manager'"))[0]!;
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.insertId, role.id]);
    const adminPlayer = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const identity = await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'좋아홈 관리자','linked')", [adminPlayer.insertId, adminExternal]);
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.insertId, identity.insertId]);
  });

  after(async () => {
    if (!database) return;
    try { await database.execute("DROP TRIGGER IF EXISTS fail_home_like_outbox"); await database.close(); }
    catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; }
  });

  it("limits, ranks, replays, shadows, rolls back, resets safely and reconnects", async () => {
    const service = () => new HomeLikeService(database);
    const firstId = `home-like-first-${suffix}`;
    await event(firstId, actorExternal);
    const first = await service().execute({ eventId: firstId, externalUserId: actorExternal, destinationId: room, message: `/좋아홈 ${targetName}` });
    assert.equal(first.likeCount, "1");
    const replay = await service().execute({ eventId: firstId, externalUserId: actorExternal, destinationId: room, message: `/좋아홈 ${targetName}` });
    assert.equal(replay.replayed, true);
    assert.equal((await database.query<Array<{ like_count: bigint }>>("SELECT like_count FROM player_homes WHERE player_id=?", [targetId]))[0]!.like_count, 1n);
    const secondId = `home-like-second-${suffix}`; await event(secondId, actorExternal);
    await service().execute({ eventId: secondId, externalUserId: actorExternal, destinationId: room, message: `/좋아홈 ${targetName}` });
    const limitedId = `home-like-limited-${suffix}`; await event(limitedId, actorExternal);
    await assert.rejects(() => service().execute({ eventId: limitedId, externalUserId: actorExternal, destinationId: room, message: `/좋아홈 ${targetName}` }), /2회를 모두/);
    const rankId = `home-like-rank-${suffix}`; await event(rankId, actorExternal);
    const rank = await service().execute({ eventId: rankId, externalUserId: actorExternal, destinationId: room, message: "/좋아홈순위" });
    assert.match(rank.message, new RegExp(`${targetName} - 2 좋아홈`));
    const beforeRollback = (await database.query<Array<{ like_count: bigint }>>("SELECT like_count FROM player_homes WHERE player_id=?", [targetId]))[0]!.like_count;
    await database.execute("UPDATE player_counters SET value=1 WHERE player_id=? AND counter_code='home_like_sent'", [actorId]);
    const rollbackId = `home-like-rollback-${suffix}`; await event(rollbackId, actorExternal);
    await database.execute("CREATE TRIGGER fail_home_like_outbox BEFORE INSERT ON outbox_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic home like outbox failure'");
    await assert.rejects(() => service().execute({ eventId: rollbackId, externalUserId: actorExternal, destinationId: room, message: `/좋아홈 ${targetName}` }), /synthetic home like outbox failure/);
    await database.execute("DROP TRIGGER fail_home_like_outbox");
    assert.equal((await database.query<Array<{ like_count: bigint }>>("SELECT like_count FROM player_homes WHERE player_id=?", [targetId]))[0]!.like_count, beforeRollback);
    assert.equal(await database.verifyRollback(), true);
    const alertBefore = (await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM pet_home_activity_alerts WHERE owner_player_id=?", [targetId]))[0]!.count;
    const counterBefore = (await database.query<Array<{ value: bigint }>>("SELECT value FROM player_counters WHERE player_id=? AND counter_code='home_like_sent'", [actorId]))[0]!.value;
    const resetId = `home-like-reset-${suffix}`; await event(resetId, adminExternal);
    const reset = await service().execute({ eventId: resetId, externalUserId: adminExternal, destinationId: room, message: "/좋아홈초기화" });
    assert.equal(reset.affectedCount, "1");
    assert.equal((await database.query<Array<{ like_count: bigint }>>("SELECT like_count FROM player_homes WHERE player_id=?", [targetId]))[0]!.like_count, 0n);
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM pet_home_activity_alerts WHERE owner_player_id=?", [targetId]))[0]!.count, alertBefore);
    assert.equal((await database.query<Array<{ value: bigint }>>("SELECT value FROM player_counters WHERE player_id=? AND counter_code='home_like_sent'", [actorId]))[0]!.value, counterBefore);
    const operationCount = (await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM operations WHERE idempotency_scope='home.like.action'"))[0]!.count;
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "home-like-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    process.env.HOME_LIKE_COMMAND_ENABLED = "true"; process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='HOME_LIKE_MUTATE'");
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async () => {} });
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: `/좋아홈 ${targetName}`, room: "고도화펫테스트방", sender: actorName, json: { _id: `home-like-shadow-${suffix}`, chat_id: room, user_id: actorExternal } } });
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM operations WHERE idempotency_scope='home.like.action'"))[0]!.count, operationCount);
    await app.close();
    database = open();
    const reconnectReplay = await service().execute({ eventId: resetId, externalUserId: adminExternal, destinationId: room, message: "/좋아홈초기화" });
    assert.equal(reconnectReplay.replayed, true);
    delete process.env.HOME_LIKE_COMMAND_ENABLED;
  });
});
