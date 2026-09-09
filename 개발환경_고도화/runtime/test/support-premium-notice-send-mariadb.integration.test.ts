import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { SupportPremiumNoticeService } from "../src/support/support-premium-notice-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("support premium notice send MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  let playerId: bigint;
  let itemId: bigint;
  const suffix = Date.now().toString();
  const external = `notice-actor-${suffix}`;
  const displayName = `알림 검증자 ${suffix}`;
  const room = "990000000000778";
  const broadcast = "broadcast:test";
  const open = (): DatabaseClient => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 8, connectTimeoutMs: 5_000 });
  const event = async (id: string): Promise<void> => { await database.execute("INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?,'iris',?,'message','test','incoming',REPEAT('8',64),'parsed','processing',UTC_TIMESTAMP(3))", [id, id]); };
  const scalar = async (sql: string, values: readonly unknown[] = []): Promise<bigint> => BigInt((await database.query<Array<{ value: bigint | string }>>(sql, values))[0]!.value);
  const service = (): SupportPremiumNoticeService => new SupportPremiumNoticeService(database);

  before(async () => {
    database = open();
    const player = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)"); playerId = player.insertId;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [playerId, displayName]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [playerId, external, displayName]);
    await database.execute("INSERT INTO player_passes(player_id,pass_code,enabled,permanent) VALUES (?,'premium',TRUE,TRUE)", [playerId]);
    itemId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code='ITEM-RWD-005'"))[0]!.id;
    await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,3,1)", [playerId, itemId]);
    await database.execute("INSERT INTO guild_territory_wars(war_key,active,rift_event_history_json) VALUES ('current',FALSE,JSON_ARRAY()) ON DUPLICATE KEY UPDATE active=FALSE", []);
  });

  after(async () => {
    if (!database) return;
    try { await database.execute("DROP TRIGGER IF EXISTS fail_support_notice_outbox"); await database.close(); }
    catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; }
  });

  it("persists free quota, speaker use, replay, concurrency, rollback and restart atomically", async () => {
    await database.execute("UPDATE guild_territory_wars SET active=TRUE WHERE war_key='current'");
    const blockedId = `notice-blocked-${suffix}`; await event(blockedId);
    assert.equal((await service().execute({ eventId: blockedId, externalUserId: external, destinationId: room, broadcastDestinationId: broadcast, message: "/알림 차단" })).status, "blocked");
    await database.execute("UPDATE guild_territory_wars SET active=FALSE WHERE war_key='current'");

    await database.execute("UPDATE player_passes SET enabled=FALSE WHERE player_id=? AND pass_code='premium'", [playerId]);
    const deniedId = `notice-denied-${suffix}`; await event(deniedId);
    assert.equal((await service().execute({ eventId: deniedId, externalUserId: external, destinationId: room, broadcastDestinationId: broadcast, message: "/알림 거절" })).status, "premium_required");
    await database.execute("UPDATE player_passes SET enabled=TRUE WHERE player_id=? AND pass_code='premium'", [playerId]);

    const longId = `notice-long-${suffix}`; await event(longId);
    assert.equal((await service().execute({ eventId: longId, externalUserId: external, destinationId: room, broadcastDestinationId: broadcast, message: `/알림 ${"가".repeat(41)}` })).status, "too_long");
    for (let index = 1; index <= 3; index++) { const id = `notice-free-${index}-${suffix}`; await event(id); const result = await service().execute({ eventId: id, externalUserId: external, destinationId: room, broadcastDestinationId: broadcast, message: `/알림 무료${index}` }); assert.equal(result.status, "success"); assert.equal(result.mode, "PREMIUM_FREE"); assert.equal(result.premiumCountAfter, index); assert.equal(result.replies![0]!.room, broadcast); }
    assert.equal(await scalar("SELECT quantity value FROM inventory_stacks WHERE player_id=? AND item_id=?", [playerId, itemId]), 3n);

    const itemIdEvent = `notice-item-${suffix}`; await event(itemIdEvent);
    const item = await service().execute({ eventId: itemIdEvent, externalUserId: external, destinationId: room, broadcastDestinationId: broadcast, message: "/알림 아이템" });
    assert.equal(item.mode, "ITEM"); assert.equal(item.inventoryAfter, "2");
    assert.equal((await service().execute({ eventId: itemIdEvent, externalUserId: external, destinationId: room, broadcastDestinationId: broadcast, message: "/알림 아이템" })).replayed, true);

    const concurrentId = `notice-concurrent-${suffix}`; await event(concurrentId);
    const concurrent = await Promise.all([service().execute({ eventId: concurrentId, externalUserId: external, destinationId: room, broadcastDestinationId: broadcast, message: "/알림 동시" }), service().execute({ eventId: concurrentId, externalUserId: external, destinationId: room, broadcastDestinationId: broadcast, message: "/알림 동시" })]);
    assert.equal(concurrent.filter(result => result.replayed === false).length, 1); assert.equal(concurrent.filter(result => result.replayed === true).length, 1);
    assert.equal(await scalar("SELECT quantity value FROM inventory_stacks WHERE player_id=? AND item_id=?", [playerId, itemId]), 1n);
    const limitId = `notice-limit-${suffix}`; await event(limitId);
    assert.equal((await service().execute({ eventId: limitId, externalUserId: external, destinationId: room, broadcastDestinationId: broadcast, message: "/알림 제한" })).status, "item_limit");

    await database.execute("UPDATE support_premium_notice_daily_usage SET item_count=1,version=version+1 WHERE player_id=?", [playerId]);
    await database.execute("UPDATE inventory_stacks SET quantity=2,version=version+1 WHERE player_id=? AND item_id=?", [playerId, itemId]);
    const beforeRollback = { inventory: await scalar("SELECT quantity value FROM inventory_stacks WHERE player_id=? AND item_id=?", [playerId, itemId]), itemCount: await scalar("SELECT item_count value FROM support_premium_notice_daily_usage WHERE player_id=?", [playerId]), operations: await scalar("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='support.premium_notice_send'") };
    const rollbackId = `notice-rollback-${suffix}`; await event(rollbackId);
    await database.execute("CREATE TRIGGER fail_support_notice_outbox BEFORE INSERT ON outbox_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic support notice outbox failure'");
    await assert.rejects(() => service().execute({ eventId: rollbackId, externalUserId: external, destinationId: room, broadcastDestinationId: broadcast, message: "/알림 롤백" }), /synthetic support notice outbox failure/);
    await database.execute("DROP TRIGGER fail_support_notice_outbox");
    const afterRollback = { inventory: await scalar("SELECT quantity value FROM inventory_stacks WHERE player_id=? AND item_id=?", [playerId, itemId]), itemCount: await scalar("SELECT item_count value FROM support_premium_notice_daily_usage WHERE player_id=?", [playerId]), operations: await scalar("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='support.premium_notice_send'") };
    assert.deepEqual(afterRollback, beforeRollback); assert.equal(await database.verifyRollback(), true);

    const executionsBeforeRestart = await scalar("SELECT COUNT(*) value FROM support_premium_notice_executions");
    await database.close(); database = open();
    assert.equal((await service().execute({ eventId: concurrentId, externalUserId: external, destinationId: room, broadcastDestinationId: broadcast, message: "/알림 동시" })).replayed, true);
    assert.equal(await scalar("SELECT COUNT(*) value FROM support_premium_notice_executions"), executionsBeforeRestart);
    const registry = (await database.query<Array<{ rollout_state: string; enabled: number }>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code='SUPPORT_PREMIUM_NOTICE_SEND'"))[0]!;
    assert.equal(registry.rollout_state, "SHADOW"); assert.equal(registry.enabled, 1);

    const operationsBeforeShadow = await scalar("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='support.premium_notice_send'");
    const token = "support-notice-shadow-token";
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "support-notice-shadow-pepper-32", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    process.env.SUPPORT_PREMIUM_NOTICE_COMMAND_ENABLED = "true"; process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async () => {} });
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: "/알림 SHADOW", room: "고도화펫테스트방", sender: displayName, json: { _id: `notice-shadow-${suffix}`, chat_id: room, user_id: external } } });
    assert.equal(await scalar("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='support.premium_notice_send'"), operationsBeforeShadow);
    delete process.env.SUPPORT_PREMIUM_NOTICE_COMMAND_ENABLED; delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
    await app.close();
    process.stdout.write(JSON.stringify({ free: 3, itemNew: 2, concurrentReplay: true, inventory: "2", rollbackStable: true, restartReplay: true, rollout: registry.rollout_state }) + "\n");
  });
});
