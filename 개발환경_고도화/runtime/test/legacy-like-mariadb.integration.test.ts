import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { legacyLikeKstDate, LegacyLikeService } from "../src/social/legacy-like-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("legacy social like MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  let actorId: bigint;
  let targetId: bigint;
  const suffix = Date.now().toString();
  const room = "synthetic-legacy-like-room";
  const actorExternal = `legacy-like-actor-${suffix}`;
  const adminExternal = `legacy-like-admin-${suffix}`;
  const actorName = `좋아요 사용자 ${suffix}`;
  const targetName = `좋아요 대상 ${suffix}`;
  const open = (): DatabaseClient => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 8, connectTimeoutMs: 5_000 });
  const event = async (id: string): Promise<void> => { await database.execute("INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?,'iris',?,'message','test','incoming',REPEAT('6',64),'parsed','processing',UTC_TIMESTAMP(3))", [id, id]); };

  before(async () => {
    database = open();
    await database.execute("UPDATE castle_battle_season_state SET active_season_id=NULL,version=version+1 WHERE scope_key='GLOBAL'");
    for (const [externalId, displayName, point] of [[actorExternal, actorName, 100], [`legacy-like-target-${suffix}`, targetName, 0]] as const) {
      const player = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [player.insertId, displayName]);
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.insertId, externalId, displayName]);
      await database.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',?,1)", [player.insertId, point]);
      if (externalId === actorExternal) actorId = player.insertId; else targetId = player.insertId;
    }
    const adminPlayer = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'좋아요 관리자',1)", [adminPlayer.insertId]);
    const identity = await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'좋아요 관리자','linked')", [adminPlayer.insertId, adminExternal]);
    const operator = await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,?,'active')", [`legacy-like-admin-${suffix}`, "좋아요 관리자", "synthetic"]);
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='manager'"))[0]!;
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.insertId, role.id]);
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.insertId, identity.insertId]);
  });

  after(async () => { if (database) { await database.execute("DROP TRIGGER IF EXISTS fail_legacy_like_outbox"); await database.close(); } });

  it("deducts points, caps daily use, ranks, rolls back, resets and replays", async () => {
    const service = () => new LegacyLikeService(database);
    const firstId = `legacy-like-first-${suffix}`; await event(firstId);
    const first = await service().execute({ eventId: firstId, externalUserId: actorExternal, destinationId: room, message: `/좋아요 ${targetName}` });
    assert.deepEqual({ message: first.message, pointAfter: first.pointAfter, usageAfter: first.usageAfter, currentLikeAfter: first.currentLikeAfter }, { message: "💕", pointAfter: "92", usageAfter: "1", currentLikeAfter: "1" });
    assert.equal((await service().execute({ eventId: firstId, externalUserId: actorExternal, destinationId: room, message: `/좋아요 ${targetName}` })).replayed, true);
    const secondId = `legacy-like-second-${suffix}`; await event(secondId); await service().execute({ eventId: secondId, externalUserId: actorExternal, destinationId: room, message: `/좋아요 ${targetName}` });
    const limitedId = `legacy-like-limited-${suffix}`; await event(limitedId); await assert.rejects(() => service().execute({ eventId: limitedId, externalUserId: actorExternal, destinationId: room, message: `/좋아요 ${targetName}` }), /2번을 모두/);
    await database.execute("UPDATE currency_accounts SET balance=100,version=version+1 WHERE player_id=? AND currency_code='point'", [actorId]);
    await database.execute("UPDATE player_counters SET value=0 WHERE player_id=? AND counter_code='cntlike' AND period_key=?", [actorId, legacyLikeKstDate()]);
    const concurrentIds = [0, 1, 2].map((index) => `legacy-like-concurrent-${index}-${suffix}`);
    for (const id of concurrentIds) await event(id);
    const concurrent = await Promise.allSettled(concurrentIds.map((eventId) => service().execute({ eventId, externalUserId: actorExternal, destinationId: room, message: `/좋아요 ${targetName}` })));
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 2);
    assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
    const concurrentState = (await database.query<Array<{ balance: string; usage_count: bigint; current_like: bigint }>>("SELECT CAST((SELECT balance FROM currency_accounts WHERE player_id=? AND currency_code='point') AS CHAR) balance,(SELECT value FROM player_counters WHERE player_id=? AND counter_code='cntlike' AND period_key=?) usage_count,(SELECT value FROM player_counters WHERE player_id=? AND counter_code='like' AND period_key='current') current_like", [actorId, actorId, legacyLikeKstDate(), targetId]))[0]!;
    assert.deepEqual(concurrentState, { balance: "84.000", usage_count: 2n, current_like: 4n });
    const rankId = `legacy-like-rank-${suffix}`; await event(rankId); const rank = await service().execute({ eventId: rankId, externalUserId: actorExternal, destinationId: room, message: "/좋아요순위" }); assert.match(rank.message, new RegExp(`${targetName} - 💕:4`));
    await database.execute("UPDATE player_counters SET value=1 WHERE player_id=? AND counter_code='cntlike' AND period_key=?", [actorId, legacyLikeKstDate()]);
    const rollbackId = `legacy-like-rollback-${suffix}`; await event(rollbackId);
    await database.execute("CREATE TRIGGER fail_legacy_like_outbox BEFORE INSERT ON outbox_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic legacy like outbox failure'");
    await assert.rejects(() => service().execute({ eventId: rollbackId, externalUserId: actorExternal, destinationId: room, message: `/좋아요 ${targetName}` }), /synthetic legacy like outbox failure/);
    await database.execute("DROP TRIGGER fail_legacy_like_outbox");
    assert.equal((await database.query<Array<{ value: bigint }>>("SELECT value FROM player_counters WHERE player_id=? AND counter_code='like' AND period_key='current'", [targetId]))[0]!.value, 4n);
    const resetId = `legacy-like-reset-${suffix}`; await event(resetId); const reset = await service().execute({ eventId: resetId, externalUserId: adminExternal, destinationId: room, message: "/좋아리셋" }); assert.equal(reset.affectedCount, "1");
    const counters = await database.query<Array<{ counter_code: string; value: bigint }>>("SELECT counter_code,value FROM player_counters WHERE player_id=? AND ((counter_code='like' AND period_key='current') OR (counter_code='like0' AND period_key='lifetime') OR (counter_code='like' AND period_key='lifetime')) ORDER BY counter_code,period_key", [targetId]);
    assert.deepEqual(Object.fromEntries(counters.map((row) => [row.counter_code, row.value])), { like: 4n, like0: 4n });
    const dailyId = `legacy-like-daily-${suffix}`; await event(dailyId); const daily = await service().execute({ eventId: dailyId, externalUserId: adminExternal, destinationId: room, message: "/r" }); assert.equal(daily.usageAfter, "0");
    await database.close(); database = open();
    assert.equal((await service().execute({ eventId: resetId, externalUserId: adminExternal, destinationId: room, message: "/좋아리셋" })).replayed, true);
  });
});
