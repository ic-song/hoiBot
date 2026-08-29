import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { createHomeBadgeCubeSeed, HomeBadgeCubeService, planHomeBadgeCubeRoll, type HomeBadgeCubeOption, type HomeBadgeCubeRateBand } from "../src/home/home-badge-cube-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_home_badge_cube(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic home badge cube probe blocked: ${config.database.name}`);
const base = process.env.HOME_BADGE_CUBE_PROBE_EVENT_ID ?? "home-badge-cube-g7-20260830-r1";
const restart = process.argv.includes("--verify-restart");
const db = createDatabaseClient(config.database);
const room = "synthetic-home-badge-cube-room", actor = "home-badge-cube-actor";
const broadcastRooms = ["synthetic-home-badge-cube-notice-1", "synthetic-home-badge-cube-notice-2"];
const playerId = 996000000n, successEvent = `${base}-success`;

async function event(id: string): Promise<void> {
  await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('c',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [id, id, room, actor]);
}
function failAudit(inner: DatabaseClient): DatabaseClient {
  return { ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params), verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction(transaction => work({ query: (sql, params) => transaction.query(sql, params), execute: async (sql, params) => { if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic home badge cube audit failure"); return transaction.execute(sql, params); } })) };
}
async function snapshot(): Promise<Array<{ cubes: bigint; quantity: bigint; rolls: bigint; operations: bigint; ledgers: bigint; outboxes: bigint }>> {
  return db.query(`SELECT
    (SELECT COUNT(*) FROM player_home_badge_cubes WHERE player_id=${playerId}) cubes,
    (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=${playerId} AND item.code='ITEM-HOME-BADGE-CUBE') quantity,
    (SELECT COUNT(*) FROM home_badge_cube_rolls roll JOIN operations operation ON operation.id=roll.operation_id WHERE operation.idempotency_scope='home.badge.cube') rolls,
    (SELECT COUNT(*) FROM operations WHERE idempotency_scope='home.badge.cube') operations,
    (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation ON operation.id=ledger.operation_id WHERE operation.idempotency_scope='home.badge.cube') ledgers,
    (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope='home.badge.cube') outboxes`);
}
async function seededEvent(prefix: string, badgeCode: string, option: HomeBadgeCubeOption, bands: HomeBadgeCubeRateBand[], threshold: number): Promise<string> {
  for (let attempt = 0; attempt < 200000; attempt++) {
    const id = `${base}-${prefix}-${attempt}`;
    const seed = createHomeBadgeCubeSeed(option.content_hash, id, playerId.toString(), badgeCode, option.option_code, 1n);
    if (planHomeBadgeCubeRoll(seed, 1, bands).rolledTenths >= threshold) return id;
  }
  throw new Error(`deterministic cube event not found: ${prefix}`);
}

try {
  if (restart) {
    const before = await snapshot();
    const replay = await new HomeBadgeCubeService(db, broadcastRooms).execute({ eventId: successEvent, externalUserId: actor, destinationId: room, message: "/홈뱃지큐브 1 1 3" });
    assert.equal(replay.replayed, true); assert.deepEqual(await snapshot(), before);
    process.stdout.write(JSON.stringify({ mode: "verify-restart", additionalMutation: false, operationalDataTouched: false }) + "\n");
  } else {
    await db.execute("INSERT INTO players(id,status) VALUES (?,'active')", [playerId]);
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,'홈뱃지큐브검증자')", [playerId]);
    await db.execute("INSERT INTO external_identities(id,provider_code,external_user_id,player_id,status) VALUES (996100000,'kakao',?,?,'linked')", [actor, playerId]);
    await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT ?,id,1000,1 FROM item_definitions WHERE code='ITEM-HOME-BADGE-CUBE'", [playerId]);
    await db.execute("INSERT INTO player_badge_assignments(player_id,badge_code,display_value,priority) SELECT ?,'HB001',CONCAT(emoji_value,' ',display_name),1 FROM home_badge_definitions WHERE definition_version_id=930000002 AND badge_code='HB001'", [playerId]);
    await db.execute("INSERT INTO player_home_badges(player_id,badge_code,owned,equipped,version) VALUES (?,'HB001',TRUE,TRUE,1)", [playerId]);
    const registry = (await db.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='HOME_BADGE_CUBE'"))[0];
    assert.equal(registry?.rollout_state, "SHADOW");
    const deletedEvent = `${base}-deleted`; await event(deletedEvent);
    await db.execute("INSERT INTO player_home_badge_exclusions(player_id,badge_code,reason_code) VALUES (?,'HB001','synthetic_permanent_delete')", [playerId]);
    assert.equal((await new HomeBadgeCubeService(db).execute({ eventId: deletedEvent, externalUserId: actor, destinationId: room, message: "/홈뱃지큐브 1 1" })).status, "invalid_selection");
    await db.execute("DELETE FROM player_home_badge_exclusions WHERE player_id=? AND badge_code='HB001'", [playerId]);
    const rollbackEvent = `${base}-rollback`; await event(rollbackEvent); const beforeRollback = await snapshot();
    await assert.rejects(() => new HomeBadgeCubeService(failAudit(db)).execute({ eventId: rollbackEvent, externalUserId: actor, destinationId: room, message: "/홈뱃지큐브 1 1 2" }), /synthetic home badge cube audit failure/);
    assert.deepEqual(await snapshot(), beforeRollback); assert.equal(await db.verifyRollback(), true);
    await event(successEvent);
    const [first, concurrent] = await Promise.all([
      new HomeBadgeCubeService(db, broadcastRooms).execute({ eventId: successEvent, externalUserId: actor, destinationId: room, message: "/홈뱃지큐브 1 1 3" }),
      new HomeBadgeCubeService(db, broadcastRooms).execute({ eventId: successEvent, externalUserId: actor, destinationId: room, message: "/홈뱃지큐브 1 1 3" })
    ]);
    assert.equal(first.status, "success"); assert.equal(concurrent.status, "success"); assert.ok(first.replayed === true || concurrent.replayed === true);
    const effects = await snapshot(); assert.equal(effects[0]!.quantity, 997n); assert.equal(effects[0]!.rolls, 3n); assert.equal(effects[0]!.operations, 2n); assert.equal(effects[0]!.ledgers, 1n);
    const option = (await db.query<HomeBadgeCubeOption[]>(`SELECT option_row.config_version_id,version.definition_version_id,version.content_hash,option_row.option_number,option_row.option_code,option_row.emoji_value,option_row.display_name,option_row.cost_quantity,option_row.maximum_tenths,option_row.item_id,item.display_name item_display_name FROM home_badge_cube_options option_row JOIN home_badge_cube_config_versions version ON version.id=option_row.config_version_id JOIN item_definitions item ON item.id=option_row.item_id WHERE option_row.option_number=1`))[0]!;
    const bands = await db.query<HomeBadgeCubeRateBand[]>("SELECT band_ordinal,minimum_tenths,maximum_tenths,weight_value FROM home_badge_cube_rate_bands WHERE config_version_id=? ORDER BY band_ordinal", [option.config_version_id]);
    await db.execute("UPDATE player_home_badge_cubes SET castle_percent=9.9 WHERE player_id=? AND badge_code='HB001'", [playerId]);
    const milestoneEvent = await seededEvent("milestone", "HB001", option, bands, 100); await event(milestoneEvent);
    const milestone = await new HomeBadgeCubeService(db, broadcastRooms).execute({ eventId: milestoneEvent, externalUserId: actor, destinationId: room, message: "/홈뱃지큐브 1 1" });
    assert.deepEqual(milestone.milestones, [10]); assert.equal(milestone.replies?.length, 3);
    await db.execute("UPDATE player_home_badge_cubes SET castle_percent=49.9,raid_percent=50,pet_upgrade_percent=30,explore_percent=15 WHERE player_id=? AND badge_code='HB001'", [playerId]);
    const allMaxEvent = await seededEvent("allmax", "HB001", option, bands, 500); await event(allMaxEvent);
    const maximum = await new HomeBadgeCubeService(db, broadcastRooms).execute({ eventId: allMaxEvent, externalUserId: actor, destinationId: room, message: "/홈뱃지큐브 1 1" });
    assert.equal(maximum.afterTenths, 500); assert.equal(maximum.allMaxNotice, true); assert.equal(maximum.replies?.length, 5);
    process.stdout.write(JSON.stringify({ mode: "probe", scenarios: ["v2.400-config", "shadow-registry", "tombstone-exclusion", "rollback", "deterministic-two-stage-rng", "same-event-concurrency", "integer-protection", "milestone-ordered-outbox", "all-max-ordered-outbox"], effects: effects[0], operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? Number(value) : value) + "\n");
  }
} finally { await db.close(); }
