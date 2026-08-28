import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { HomeBadgeEquipService } from "../src/home/home-badge-equip-service.js";

const enabled = process.env.HOME_BADGE_EQUIP_MARIADB_TEST === "1";

test("홈뱃지 장착·해제 MariaDB 원자성·멱등성·재시작", { skip: !enabled }, async () => {
  const config = loadConfig();
  assert.match(config.database.name, /^hoibot_home_badge_equip(?:_[a-z0-9_]+)?$/i);
  let database = createDatabaseClient(config.database);
  const playerId = 990000110n;
  const externalUserId = `badge-equip-${Date.now()}`;
  const room = "isolated-home-badge-equip";
  const service = () => new HomeBadgeEquipService(database);
  const addEvent = async (eventId: string): Promise<void> => {
    await database.execute(
      "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('3',64),'processed',UTC_TIMESTAMP(3))",
      [eventId, eventId, room, externalUserId]
    );
  };
  const failAudit = (inner: DatabaseClient): DatabaseClient => ({
    ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params),
    execute: (sql, params) => inner.execute(sql, params), verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (tx: DatabaseTransaction) => Promise<T>) => inner.withTransaction((tx) => work({
      query: (sql, params) => tx.query(sql, params),
      execute: async (sql, params) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("forced badge equip rollback");
        return tx.execute(sql, params);
      }
    }))
  });
  try {
    await database.execute("INSERT INTO players(id,status) VALUES (?,'active')", [playerId]);
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,tier_code) VALUES (?,'뱃지 장착자','king')", [playerId]);
    await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (?,?, 'kakao',?,?,'linked')", [playerId, playerId, externalUserId, "뱃지 장착자"]);
    const version = (await database.query<Array<{ id: bigint }>>("SELECT id FROM home_badge_definition_versions WHERE status='shadow' ORDER BY id DESC LIMIT 1"))[0]!.id;
    const badges = await database.query<Array<{ badge_code: string }>>("SELECT badge_code FROM home_badge_definitions WHERE definition_version_id=? ORDER BY ordinal LIMIT 2", [version]);
    assert.equal(badges.length, 2);
    const first = badges[0]!.badge_code, second = badges[1]!.badge_code;
    await database.execute("INSERT INTO player_badge_assignments(player_id,badge_code,display_value,priority) VALUES (?,?,?,1),(?,?,?,2)", [playerId, first, first, playerId, second, second]);
    await database.execute("INSERT INTO player_home_badges(player_id,badge_code,owned,equipped) VALUES (?,?,TRUE,FALSE),(?,?,TRUE,FALSE)", [playerId, first, playerId, second]);
    await database.execute("INSERT INTO player_home_badge_cubes(player_id,badge_code,castle_percent,raid_percent,pet_upgrade_percent,explore_percent,equipped) VALUES (?,?,11,12,13,14,FALSE),(?,?,21,22,23,24,FALSE)", [playerId, first, playerId, second]);
    const registry = await database.query<Array<{ command_code: string; rollout_state: string }>>("SELECT command_code,rollout_state FROM command_registry WHERE command_code IN ('HOME_BADGE_EQUIP','HOME_BADGE_UNEQUIP') ORDER BY command_code");
    assert.deepEqual(registry, [{ command_code: "HOME_BADGE_EQUIP", rollout_state: "SHADOW" }, { command_code: "HOME_BADGE_UNEQUIP", rollout_state: "SHADOW" }]);

    const event = `equip-${Date.now()}`;
    await addEvent(event);
    const [a, b] = await Promise.all([
      service().execute({ eventId: event, externalUserId, destinationId: room, message: "/홈뱃지장착 01" }),
      service().execute({ eventId: event, externalUserId, destinationId: room, message: "/홈뱃지장착 01" })
    ]);
    assert.equal(a.badgeCode, first);
    assert.equal(b.badgeCode, first);
    assert.deepEqual([a.replayed, b.replayed].sort(), [false, true]);
    const equipped = await database.query<Array<{ badge_code: string }>>("SELECT badge_code FROM player_home_badges WHERE player_id=? AND equipped=TRUE", [playerId]);
    assert.deepEqual(equipped, [{ badge_code: first }]);
    const cube = (await database.query<Array<{ castle_percent: string; equipped: number }>>("SELECT castle_percent,equipped FROM player_home_badge_cubes WHERE player_id=? AND badge_code=?", [playerId, first]))[0]!;
    assert.equal(cube.castle_percent, "11.000");
    assert.equal(cube.equipped, 1);

    const invalidEvent = `invalid-${Date.now()}`;
    await addEvent(invalidEvent);
    const invalid = await service().execute({ eventId: invalidEvent, externalUserId, destinationId: room, message: "/홈뱃지장착 999" });
    assert.equal(invalid.resultCode, "invalid_selection");
    assert.deepEqual(await database.query<Array<{ badge_code: string }>>("SELECT badge_code FROM player_home_badges WHERE player_id=? AND equipped=TRUE", [playerId]), [{ badge_code: first }]);

    const rollbackEvent = `rollback-${Date.now()}`;
    await addEvent(rollbackEvent);
    await assert.rejects(new HomeBadgeEquipService(failAudit(database)).execute({ eventId: rollbackEvent, externalUserId, destinationId: room, message: `/홈뱃지장착 ${second}` }), /forced badge equip rollback/);
    assert.deepEqual(await database.query<Array<{ badge_code: string }>>("SELECT badge_code FROM player_home_badges WHERE player_id=? AND equipped=TRUE", [playerId]), [{ badge_code: first }]);
    assert.equal(await database.verifyRollback(), true);

    const unequipEvent = `unequip-${Date.now()}`;
    await addEvent(unequipEvent);
    const unequip = await service().execute({ eventId: unequipEvent, externalUserId, destinationId: room, message: "/홈뱃지해제" });
    assert.equal(unequip.resultCode, "success");
    assert.equal((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM player_home_badges WHERE player_id=? AND equipped=TRUE", [playerId]))[0]!.count_value, 0n);
    await database.close();
    database = createDatabaseClient(config.database);
    const replay = await service().execute({ eventId: unequipEvent, externalUserId, destinationId: room, message: "/홈뱃지해제" });
    assert.equal(replay.replayed, true);
    assert.equal(replay.outboxId, unequip.outboxId);
  } finally {
    await database.close();
  }
});
