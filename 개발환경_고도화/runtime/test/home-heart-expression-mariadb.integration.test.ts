import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { HomeHeartExpressionService } from "../src/home/home-heart-expression-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("home heart expression MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  let actorId: bigint;
  let targetId: bigint;
  const suffix = Date.now().toString();
  const actorExternal = `heart-actor-${suffix}`;
  const actorName = `마음 검증자 ${suffix}`;
  const targetName = `마음 대상 긴 이름 ${suffix}`;
  const friendName = `마음 친구 ${suffix}`;
  const room = "990000000000777";
  const open = (): DatabaseClient => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 8, connectTimeoutMs: 5_000 });
  const event = async (id: string): Promise<void> => { await database.execute("INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?,'iris',?,'message','test','incoming',REPEAT('7',64),'parsed','processing',UTC_TIMESTAMP(3))", [id, id]); };
  const scalar = async (sql: string, values: readonly unknown[] = []): Promise<bigint> => BigInt((await database.query<Array<{ value: bigint | string }>>(sql, values))[0]!.value);

  before(async () => {
    database = open();
    const createPlayer = async (name: string, external: string | null): Promise<bigint> => {
      const player = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [player.insertId, name]);
      await database.execute("INSERT INTO player_homes(player_id,display_name,version) VALUES (?,?,1)", [player.insertId, name]);
      if (external !== null) await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.insertId, external, name]);
      return player.insertId;
    };
    actorId = await createPlayer(actorName, actorExternal);
    targetId = await createPlayer(targetName, null);
    const friendId = await createPlayer(friendName, null);
    for (const [playerId, passCode] of [[actorId, "support"], [actorId, "premium"], [targetId, "support"], [friendId, "support"]] as const) await database.execute("INSERT INTO player_passes(player_id,pass_code,enabled,permanent) VALUES (?,?,TRUE,TRUE)", [playerId, passCode]);
    await database.execute("INSERT INTO pet_home_follows(follower_player_id,followed_player_id,active,version) VALUES (?,?,TRUE,1),(?,?,TRUE,1)", [actorId, friendId, friendId, actorId]);
    const pet = await database.execute("INSERT INTO player_pets(player_id,display_name,version) VALUES (?,?,1)", [actorId, "망므펫"]);
    const skill = await database.execute("INSERT INTO skill_definitions(code,display_name,rules_json,active) VALUES (?,?,JSON_OBJECT('heartBonus',5),TRUE)", [`SKILL-HEART-BONUS-${suffix}`, "망므📙"]);
    await database.execute("INSERT INTO pet_skills(player_pet_id,slot_no,skill_id,level,equipped) VALUES (?,1,?,1,TRUE)", [pet.insertId, skill.insertId]);
  });

  after(async () => {
    if (!database) return;
    try { await database.execute("DROP TRIGGER IF EXISTS fail_home_heart_outbox"); await database.close(); }
    catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; }
  });

  it("persists quota, allocation, badge, alerts, replay and rollback atomically across reconnect", async () => {
    const service = () => new HomeHeartExpressionService(database);
    const firstId = `heart-first-${suffix}`; await event(firstId);
    const first = await service().execute({ eventId: firstId, externalUserId: actorExternal, destinationId: room, message: `/마음 ${targetName} 3` });
    assert.equal(first.status, "success"); assert.equal(first.limit, "22"); assert.equal(first.usedAfter, "3"); assert.equal(first.remainingAfter, "19");
    assert.equal(first.allocations!.reduce((sum, row) => sum + BigInt(row.quantity), 0n), 3n);
    assert.equal((await service().execute({ eventId: firstId, externalUserId: actorExternal, destinationId: room, message: `/마음 ${targetName} 3` })).replayed, true);

    const concurrentId = `heart-concurrent-${suffix}`; await event(concurrentId);
    const concurrent = await Promise.all([
      service().execute({ eventId: concurrentId, externalUserId: actorExternal, destinationId: room, message: `/사랑해 ${targetName} 2` }),
      service().execute({ eventId: concurrentId, externalUserId: actorExternal, destinationId: room, message: `/사랑해 ${targetName} 2` })
    ]);
    assert.equal(concurrent.filter(result => result.replayed === false).length, 1);
    assert.equal(concurrent.filter(result => result.replayed === true).length, 1);
    assert.equal(await scalar("SELECT used_count value FROM player_pet_home_heart_usage WHERE player_id=?", [actorId]), 5n);
    assert.equal(await scalar("SELECT COALESCE(SUM(quantity),0) value FROM home_heart_expression_totals WHERE home_player_id=?", [targetId]), 5n);
    assert.equal(await scalar("SELECT received_reactions value FROM pet_home_badge_stats WHERE player_id=?", [targetId]), 5n);
    assert.equal(await scalar("SELECT COUNT(*) value FROM home_heart_expression_executions WHERE actor_player_id=?", [actorId]), 2n);
    assert.equal(await scalar("SELECT COUNT(*) value FROM home_heart_expression_rolls roll JOIN home_heart_expression_executions run ON run.operation_id=roll.operation_id WHERE run.actor_player_id=?", [actorId]), 5n);
    assert.equal(await scalar("SELECT COUNT(*) value FROM player_home_badges WHERE player_id=? AND badge_code='R01' AND owned=TRUE", [targetId]), 1n);

    const insufficientId = `heart-insufficient-${suffix}`; await event(insufficientId);
    assert.equal((await service().execute({ eventId: insufficientId, externalUserId: actorExternal, destinationId: room, message: `/응원해 ${targetName} 100` })).status, "insufficient");
    const zeroId = `heart-zero-${suffix}`; await event(zeroId);
    assert.equal((await service().execute({ eventId: zeroId, externalUserId: actorExternal, destinationId: room, message: `/귀여워 ${targetName} 0` })).status, "quantity_invalid");
    assert.equal(await scalar("SELECT used_count value FROM player_pet_home_heart_usage WHERE player_id=?", [actorId]), 5n);

    const before = { total: await scalar("SELECT COALESCE(SUM(quantity),0) value FROM home_heart_expression_totals WHERE home_player_id=?", [targetId]), usage: await scalar("SELECT used_count value FROM player_pet_home_heart_usage WHERE player_id=?", [actorId]), operations: await scalar("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='home.heart_expression'") };
    const rollbackId = `heart-rollback-${suffix}`; await event(rollbackId);
    await database.execute("CREATE TRIGGER fail_home_heart_outbox BEFORE INSERT ON outbox_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic home heart outbox failure'");
    await assert.rejects(() => service().execute({ eventId: rollbackId, externalUserId: actorExternal, destinationId: room, message: `/멋져요 ${targetName} 1` }), /synthetic home heart outbox failure/);
    await database.execute("DROP TRIGGER fail_home_heart_outbox");
    const afterRollback = { total: await scalar("SELECT COALESCE(SUM(quantity),0) value FROM home_heart_expression_totals WHERE home_player_id=?", [targetId]), usage: await scalar("SELECT used_count value FROM player_pet_home_heart_usage WHERE player_id=?", [actorId]), operations: await scalar("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='home.heart_expression'") };
    assert.deepEqual(afterRollback, before); assert.equal(await database.verifyRollback(), true);

    const rollsBeforeRestart = await scalar("SELECT COUNT(*) value FROM home_heart_expression_rolls");
    await database.close(); database = open();
    const restartReplay = await service().execute({ eventId: concurrentId, externalUserId: actorExternal, destinationId: room, message: `/사랑해 ${targetName} 2` });
    assert.equal(restartReplay.replayed, true); assert.equal(await scalar("SELECT COUNT(*) value FROM home_heart_expression_rolls"), rollsBeforeRestart);
    const registry = (await database.query<Array<{ rollout_state: string; enabled: number }>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code='HOME_HEART_EXPRESSION'"))[0]!;
    assert.equal(registry.rollout_state, "SHADOW"); assert.equal(registry.enabled, 1);
    const operationsBeforeShadow = await scalar("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='home.heart_expression'");
    const token = "home-heart-shadow-token";
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "home-heart-shadow-pepper-32-characters", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    process.env.HOME_HEART_EXPRESSION_COMMAND_ENABLED = "true"; process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async () => {} });
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: `/귀여워 ${targetName} 1`, room: "고도화펫테스트방", sender: actorName, json: { _id: `home-heart-shadow-${suffix}`, chat_id: room, user_id: actorExternal } } });
    assert.equal(await scalar("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='home.heart_expression'"), operationsBeforeShadow);
    delete process.env.HOME_HEART_EXPRESSION_COMMAND_ENABLED; delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
    await app.close();
    process.stdout.write(JSON.stringify({ limit: first.limit, firstUsed: first.usedAfter, concurrentNew: 1, concurrentReplay: 1, total: "5", rolls: "5", badgeR01: "1", rollbackStable: true, restartReplay: true, rollout: registry.rollout_state }) + "\n");
  });
});
