import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { CastleBattleMemberEditService, parseCastleBattleMemberEditCommand } from "../src/castle/castle-battle-member-edit-service.js";

const config = loadConfig({ ...process.env, IRIS_SHARED_TOKEN: process.env.IRIS_SHARED_TOKEN ?? "synthetic-test-token-20260829" });
const enabled = config.database.enabled && config.database.name === "hoibot_castle_battle_member_edit_g7";

describe("castle battle member edit MariaDB", { skip: !enabled }, () => {
  it("persists count and score once, invalidates ranking, enforces authority, and rolls back failures", async () => {
    const database = createDatabaseClient(config.database);
    try {
      await seed(database);
      const service = new CastleBattleMemberEditService(database);
      await event(database, "member-edit-count");
      const count = await service.update(input("member-edit-count", "/캐슬대전횟수리셋 합성 회원 7"));
      assert.equal(count.after.attempts, "7");
      assert.equal(count.invalidatedSnapshotCount, "0");
      assert.equal((await snapshot(database)).snapshotStatus, "published");

      await event(database, "member-edit-score");
      const score = await service.update(input("member-edit-score", "/캐슬스코어 합성 회원 125"));
      assert.equal(score.after.score, "125");
      assert.equal(score.invalidatedSnapshotCount, "1");
      assert.equal((await snapshot(database)).snapshotStatus, "invalidated");
      assert.deepEqual(await service.update(input("member-edit-score", "/캐슬스코어 합성 회원 125")), { ...score, replayed: true });

      await event(database, "member-edit-concurrent");
      const concurrent = await Promise.all([
        service.update(input("member-edit-concurrent", "/캐슬스코어 합성 회원 150")),
        service.update(input("member-edit-concurrent", "/캐슬스코어 합성 회원 150"))
      ]);
      assert.deepEqual(concurrent.map((result) => result.replayed).sort(), [false, true]);
      const serialized = await snapshot(database);
      assert.equal(serialized.score, "150");
      assert.equal(serialized.runs, 3n);
      assert.equal(serialized.operations, 3n);

      await assert.rejects(
        () => service.update({ ...input("member-edit-unauthorized", "/캐슬스코어 합성 회원 1"), externalUserId: "not-master" }),
        /권한이 없습니다/
      );
      await event(database, "member-edit-rollback");
      const before = await snapshot(database);
      const rollbackService = new CastleBattleMemberEditService(failAudit(database));
      await assert.rejects(() => rollbackService.update(input("member-edit-rollback", "/캐슬스코어 합성 회원 250")), /synthetic castle member edit audit failure/);
      assert.deepEqual(await snapshot(database), before);
      assert.equal(await database.verifyRollback(), true);
    } finally { await database.close(); }
  });
});

function input(eventId: string, message: string) {
  return { eventId, externalUserId: "castle-member-master", channelId: "castle-member-room", command: parseCastleBattleMemberEditCommand(message) };
}

async function event(database: DatabaseClient, eventId: string): Promise<void> {
  await database.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,'castle-member-room','castle-member-master','message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3))",
    [eventId, eventId]
  );
}

async function seed(database: DatabaseClient): Promise<void> {
  await database.execute("INSERT INTO players(id,status) VALUES (988520001,'active')");
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (988520001,'합성 회원')");
  await database.execute("INSERT INTO external_identities(id,provider_code,external_user_id,status) VALUES (988520002,'kakao','castle-member-master','linked')");
  await database.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (988520001,'castle-member-master','캐슬 편집 운영자','synthetic','active')");
  await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (988520001,988520002)");
  await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT 988520001,id FROM admin_roles WHERE code='super_admin'");
  await database.execute("INSERT INTO castle_battle_seasons(id,season_key,status,starts_at,version) VALUES (988520001,'synthetic-member-edit','active',UTC_TIMESTAMP(3),1)");
  await database.execute("INSERT INTO castle_battle_player_states(season_id,player_id,score,win_count,loss_count,tier_point,version) VALUES (988520001,988520001,30,1,2,1,1)");
  await database.execute("INSERT INTO player_pet_daily_records(player_id,record_date,castle_battle_attempts,castle_battle_score,version) VALUES (988520001,DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)),4,30,1)");
  await database.execute("INSERT INTO castle_battle_rank_snapshots(season_id,snapshot_version,source_version,status,snapshot_at,published_at) VALUES (988520001,1,'synthetic-member-edit','published',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))");
}

async function snapshot(database: DatabaseClient) {
  return (await database.query<Array<{ attempts: string; score: string; tier: string; dailyScore: string; runs: bigint; operations: bigint; outboxes: bigint; audits: bigint; invalidations: bigint; snapshotStatus: string }>>(
    `SELECT
       (SELECT CAST(castle_battle_attempts AS CHAR) FROM player_pet_daily_records WHERE player_id=988520001) attempts,
       (SELECT CAST(score AS CHAR) FROM castle_battle_player_states WHERE season_id=988520001 AND player_id=988520001) score,
       (SELECT CAST(tier_point AS CHAR) FROM castle_battle_player_states WHERE season_id=988520001 AND player_id=988520001) tier,
       (SELECT CAST(castle_battle_score AS CHAR) FROM player_pet_daily_records WHERE player_id=988520001) dailyScore,
       (SELECT COUNT(*) FROM castle_battle_member_adjustment_runs) runs,
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope='castle.battle.member_edit') operations,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope='castle.battle.member_edit') outboxes,
       (SELECT COUNT(*) FROM command_audit WHERE action_code='castle.battle.member_edit') audits,
       (SELECT COUNT(*) FROM castle_battle_rank_snapshot_invalidations) invalidations,
       (SELECT status FROM castle_battle_rank_snapshots WHERE season_id=988520001 AND snapshot_version=1) snapshotStatus`
  ))[0]!;
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params),
    verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, params) => transaction.query(sql, params),
      execute: async (sql, params) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic castle member edit audit failure");
        return transaction.execute(sql, params);
      }
    }))
  };
}
